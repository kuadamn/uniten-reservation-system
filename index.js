const express = require('express');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth'); 
const serviceAccount = require('./key.json');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const PROJECT_ID = serviceAccount.project_id;

initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID
});

const db = getFirestore(undefined, 'default');
db.settings({ preferRest: true }); 

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// --- MIDDLEWARE ---
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const decodedToken = await getAuth().verifyIdToken(authHeader.split('Bearer ')[1]);
        req.user = decodedToken; 
        next(); 
    } catch (error) {
        res.status(403).json({ message: 'Forbidden' });
    }
};

// Configure Email Transporter
// ⚠️ IMPORTANT: Replace these with your actual email credentials or App Password
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: 'your-email@gmail.com', 
        pass: 'your-app-password'     
    }
});

// Helper function to send email
async function sendEmail(to, subject, text) {
    try {
        await transporter.sendMail({
            from: '"UNITEN Facility" <your-email@gmail.com>',
            to, subject, text
        });
        console.log(`📧 Email sent to ${to}`);
    } catch (err) {
        console.error("Email error:", err);
    }
}

// --- ROUTES ---

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/my-profile', authenticateUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists) return res.json({ name: "New Student", studentId: req.user.email, role: 'student' });
        res.json(userDoc.data());
    } catch (error) { res.status(500).send(error.message); }
});

app.get('/facilities', authenticateUser, async (req, res) => {
    try {
        const { search, status } = req.query; 

        const snapshot = await db.collection('facilities').get();
        let facilities = [];
        // [CHANGE] We now include doc.id so we can delete it later
        snapshot.forEach(doc => facilities.push({ id: doc.id, ...doc.data() }));

        if (status && status !== '') {
            facilities = facilities.filter(f => f.status === status);
        }

        if (search && search !== '') {
            const lowerTerm = search.toLowerCase();
            facilities = facilities.filter(f => 
                f.name.toLowerCase().includes(lowerTerm) || 
                f.type.toLowerCase().includes(lowerTerm)
            );
        }

        res.json(facilities);
    } catch(error) { res.status(500).send(error.message); }
});

app.delete('/admin/delete-facility/:id', authenticateUser, async (req, res) => {
    try {
        const facilityId = req.params.id;
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        
        // Check Admin
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return res.status(403).json({ message: "Unauthorized" });
        }

        // Delete from Firestore
        await db.collection('facilities').doc(facilityId).delete();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// CHECK REAL-TIME AVAILABILITY
app.get('/availability', authenticateUser, async (req, res) => {
    try {
        const { facility, date } = req.query;
        if (!facility || !date) return res.json([]);

        // 1. Get Capacity
        const facSnap = await db.collection('facilities').where('name', '==', facility).limit(1).get();
        if (facSnap.empty) throw new Error("Facility not found");
        const maxCap = facSnap.docs[0].data().maxCapacity;

        // 2. Get Existing Bookings
        const bookingsSnap = await db.collection('reservations')
            .where('facility', '==', facility)
            .where('date', '==', date)
            .where('status', 'in', ['pending', 'confirmed'])
            .get();

        const bookings = [];
        bookingsSnap.forEach(doc => bookings.push(doc.data()));

        // 3. Check Every Hour (08:00 - 22:00)
        const fullSlots = [];
        for (let hour = 8; hour < 22; hour++) {
            const timeString = hour.toString().padStart(2, '0') + ":00";      
            const nextHourString = (hour + 1).toString().padStart(2, '0') + ":00"; 

            let count = 0;
            bookings.forEach(b => {
                if (b.startTime < nextHourString && b.endTime > timeString) {
                    count++;
                }
            });

            if (count >= maxCap) {
                fullSlots.push(timeString);
            }
        }

        res.json(fullSlots); 
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// CREATE RESERVATION
app.post('/reserve', authenticateUser, async (req, res) => {
  try {
    const { facility, date, startTime, endTime } = req.body;
    const uid = req.user.uid; 

    if (!endTime) throw new Error("End Time is required.");
    if (startTime >= endTime) throw new Error("Start time must be before End time.");

    await db.runTransaction(async (t) => {
        const userDoc = await t.get(db.collection('users').doc(uid));
        const userData = userDoc.exists ? userDoc.data() : {};

        // Duplicate Check
        const duplicateQuery = await t.get(db.collection('reservations')
            .where('uid', '==', uid).where('facility', '==', facility).where('date', '==', date).where('startTime', '==', startTime));
        if (!duplicateQuery.empty) throw new Error("⚠️ You have already requested this slot!");

        // Facility Info
        const facilityQuery = await t.get(db.collection('facilities').where('name', '==', facility).limit(1));
        if (facilityQuery.empty) throw new Error("Facility not found!");
        const facilityDoc = facilityQuery.docs[0];
        const facData = facilityDoc.data();

        // Capacity Check
        const bookingsSnap = await t.get(db.collection('reservations')
            .where('facility', '==', facility).where('date', '==', date).where('status', 'in', ['pending', 'confirmed']));

        let overlapCount = 0;
        bookingsSnap.forEach(doc => {
            const b = doc.data();
            if (startTime < b.endTime && endTime > b.startTime) overlapCount++;
        });

        if (overlapCount >= facData.maxCapacity) {
            throw new Error(`❌ Slot Full! This time is fully booked.`);
        }

        // Stats Update
        t.update(facilityDoc.ref, { currentOccupancy: facData.currentOccupancy + 1 });

        // Save
        const newRef = db.collection('reservations').doc();
        t.set(newRef, {
            uid: uid,
            studentName: userData.name || "Unknown",
            studentId: userData.studentId || req.user.email,
            facility, date, startTime, endTime,
            status: 'pending', 
            createdAt: new Date()
        });
        res.reservationId = newRef.id;
    });

    // Send Confirmation Email
    const userEmail = req.user.email; 
    const emailBody = `
        Hi,
        Your reservation for ${facility} on ${date} (${startTime} - ${endTime}) has been received.
        Status: PENDING APPROVAL.
        
        You will be notified once an admin reviews it.
    `;
    sendEmail(userEmail, 'Reservation Received - UNITEN', emailBody);

    // [FIXED] Send Response ONCE
    res.status(200).json({ success: true, reservationId: res.reservationId });

    } catch (error) { res.status(400).json({ message: error.message }); }
});

app.get('/reservations', authenticateUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const isAdmin = userDoc.exists && userDoc.data().role === 'admin';
        let query = db.collection('reservations').orderBy('createdAt', 'desc');
        if (!isAdmin) query = query.where('uid', '==', req.user.uid);
        const snapshot = await query.get();
        const bookings = [];
        snapshot.forEach(doc => bookings.push({ id: doc.id, ...doc.data() }));
        res.status(200).json(bookings);
    } catch(error) { res.status(500).send(error.message); }
});

app.post('/admin/approve/:id', authenticateUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') return res.status(403).json({ message: "Unauthorized" });
        await db.collection('reservations').doc(req.params.id).update({ status: 'confirmed' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/admin/update-facility', authenticateUser, async (req, res) => {
    try {
        const { facilityName, newStatus } = req.body;
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') throw new Error("Unauthorized");
        const snapshot = await db.collection('facilities').where('name', '==', facilityName).limit(1).get();
        if (snapshot.empty) throw new Error("Facility not found");
        await snapshot.docs[0].ref.update({ status: newStatus });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// [NEW] Add Facility Route
app.post('/admin/add-facility', authenticateUser, async (req, res) => {
    try {
        const { name, type, maxCapacity } = req.body;
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return res.status(403).json({ message: "Unauthorized" });
        }

        await db.collection('facilities').add({
            name,
            type,
            label: name, 
            maxCapacity: parseInt(maxCapacity),
            currentOccupancy: 0,
            status: 'Open'
        });

        res.json({ success: true });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.delete('/cancel/:id', authenticateUser, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const uid = req.user.uid;
        await db.runTransaction(async (t) => {
            const resRef = db.collection('reservations').doc(reservationId);
            const resDoc = await t.get(resRef);
            if (!resDoc.exists) throw new Error("Reservation not found");
            const resData = resDoc.data();
            const userDoc = await t.get(db.collection('users').doc(uid));
            const isAdmin = userDoc.exists && userDoc.data().role === 'admin';
            if (resData.uid !== uid && !isAdmin) throw new Error("Unauthorized");
            const facilityQuery = await t.get(db.collection('facilities').where('name', '==', resData.facility).limit(1));
            if (!facilityQuery.empty) {
                const facilityDoc = facilityQuery.docs[0];
                const newOcc = Math.max(0, facilityDoc.data().currentOccupancy - 1);
                t.update(facilityDoc.ref, { currentOccupancy: newOcc });
            }
            t.delete(resRef);
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/reset-system', async (req, res) => {
    try {
        const facilities = [
            { name: 'Badminton Court A', type: 'Badminton Court', label: 'Court A', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Badminton Court B', type: 'Badminton Court', label: 'Court B', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Badminton Court C', type: 'Badminton Court', label: 'Court C', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Pickleball Court 1', type: 'Pickleball Court', label: 'Court 1', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Pickleball Court 2', type: 'Pickleball Court', label: 'Court 2', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Discussion Room 1', type: 'Discussion Room', label: 'Room 1', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Discussion Room 2', type: 'Discussion Room', label: 'Room 2', maxCapacity: 1, currentOccupancy: 0, status: 'Open' },
            { name: 'Swimming Pool', type: 'Swimming Pool', label: 'Main Pool', maxCapacity: 30, currentOccupancy: 0, status: 'Open' },
            { name: 'Football Field', type: 'Football Field', label: 'Main Field', maxCapacity: 22, currentOccupancy: 0, status: 'Open' },
        ];
        const batch = db.batch();
        const snapshot = await db.collection('facilities').get();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        const resSnap = await db.collection('reservations').get();
        resSnap.docs.forEach((doc) => batch.delete(doc.ref));
        facilities.forEach((fac) => {
            const docRef = db.collection('facilities').doc(); 
            batch.set(docRef, fac);
        });
        await batch.commit();
        res.send("✅ Database Reset: System Ready!");
    } catch (error) { res.status(500).send(error.message); }
});

cron.schedule('0 8 * * *', async () => {
    console.log("⏰ Running Daily Reminder Job...");
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0]; 

    try {
        const snapshot = await db.collection('reservations')
            .where('date', '==', dateStr)
            .where('status', '==', 'confirmed')
            .get();

        if (snapshot.empty) {
            console.log("No reminders to send for tomorrow.");
            return;
        }

        snapshot.forEach(async (doc) => {
            const booking = doc.data();
            let targetEmail = booking.studentId; 
            
            if (!targetEmail.includes('@')) {
                 const userDoc = await db.collection('users').doc(booking.uid).get();
                 if (userDoc.exists) targetEmail = userDoc.data().email; 
            }

            if (targetEmail && targetEmail.includes('@')) {
                const msg = `Reminder: You have a booking tomorrow at ${booking.startTime} for ${booking.facility}.`;
                sendEmail(targetEmail, 'Booking Reminder', msg);
            }
        });
    } catch (error) {
        console.error("Reminder Error:", error);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});