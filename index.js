const express = require('express');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth'); 
const serviceAccount = require('./key.json');

// --- CONFIGURATION ---
const PROJECT_ID = serviceAccount.project_id;

// 1. Initialize Firebase Admin
initializeApp({
  credential: cert(serviceAccount),
  projectId: PROJECT_ID
});

// 2. Get Firestore
const db = getFirestore(undefined, 'default');
db.settings({ preferRest: true }); 

const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// --------------------------------------------------------
// MIDDLEWARE: The "Security Guard"
// --------------------------------------------------------
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        req.user = decodedToken; 
        next(); 
    } catch (error) {
        console.error("❌ Blocked: Invalid token");
        res.status(403).json({ message: 'Forbidden: Invalid token' });
    }
};

// --------------------------------------------------------
// ROUTES
// --------------------------------------------------------

// 1. Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. Get User Profile (For Name/ID boxes)
app.get('/my-profile', authenticateUser, async (req, res) => {
    try {
        const uid = req.user.uid;
        const userDoc = await db.collection('users').doc(uid).get();

        if (!userDoc.exists) {
            return res.json({ name: "New Student", studentId: req.user.email, role: 'student' });
        }
        res.json(userDoc.data());
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 3. Get All Facilities
app.get('/facilities', authenticateUser, async (req, res) => {
    try {
        const snapshot = await db.collection('facilities').get();
        const facilities = [];
        snapshot.forEach(doc => facilities.push(doc.data()));
        res.json(facilities);
    } catch(error) {
        res.status(500).send(error.message);
    }
});

// 4. Create Reservation - UPDATED
app.post('/reserve', authenticateUser, async (req, res) => {
  try {
    const { facility, date, time } = req.body;
    const uid = req.user.uid; 

    await db.runTransaction(async (t) => {
        // A. Get User Info
        const userDoc = await t.get(db.collection('users').doc(uid));
        let studentName = "Unknown";
        let displayId = req.user.email; 

        if (userDoc.exists) {
            const userData = userDoc.data();
            studentName = userData.name || studentName;
            displayId = userData.studentId || displayId;
        }

        // B. Check Facility
        const facilityQuery = await t.get(db.collection('facilities').where('name', '==', facility).limit(1));
        if (facilityQuery.empty) throw new Error("Facility not found!");

        const facilityDoc = facilityQuery.docs[0];
        const facilityData = facilityDoc.data();

        // C. Check Capacity
        if (facilityData.currentOccupancy >= facilityData.maxCapacity) {
            throw new Error("❌ Booking Failed: Facility is Full!");
        }

        // D. Update Capacity & Save
        t.update(facilityDoc.ref, { currentOccupancy: facilityData.currentOccupancy + 1 });

        const newReservationRef = db.collection('reservations').doc();
        t.set(newReservationRef, {
            uid: uid,
            studentName: studentName,
            studentId: displayId,
            facility, 
            date, 
            time, 
            status: 'confirmed', 
            createdAt: new Date()
        });
        
        res.reservationId = newReservationRef.id;
    });

    res.status(200).json({ success: true, reservationId: res.reservationId });

  } catch (error) {
    console.error("Reservation Error:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// 5. Get Reservations (With Admin Filter) - UPDATED
app.get('/reservations', authenticateUser, async (req, res) => {
    try {
        const uid = req.user.uid;
        
        // Get User Role
        const userDoc = await db.collection('users').doc(uid).get();
        const userData = userDoc.data() || {};
        const userRole = userData.role || 'student';

        let query = db.collection('reservations').orderBy('createdAt', 'desc');

        // Apply Filter if NOT Admin
        if (userRole !== 'admin') {
            console.log(`👤 User is ${userRole}, filtering bookings...`);
            query = query.where('uid', '==', uid);
        } else {
            console.log(`🛡️ User is Admin, showing ALL bookings...`);
        }

        const snapshot = await query.get();
        const bookings = [];
        snapshot.forEach(doc => bookings.push({ id: doc.id, ...doc.data() }));
        
        res.status(200).json(bookings);
    } catch(error) {
        console.error("Error fetching reservations:", error.message);
        res.status(500).send(error.message);
    }
});

// [NEW] Cancel Reservation
app.delete('/cancel/:id', authenticateUser, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const uid = req.user.uid;

        await db.runTransaction(async (t) => {
            // 1. Get the Reservation
            const resRef = db.collection('reservations').doc(reservationId);
            const resDoc = await t.get(resRef);

            if (!resDoc.exists) {
                throw new Error("Reservation not found!");
            }

            const resData = resDoc.data();

            // 2. Security Check: Only Owner or Admin can cancel
            // We need to fetch the user's role first
            const userDoc = await t.get(db.collection('users').doc(uid));
            const userRole = userDoc.exists ? userDoc.data().role : 'student';

            if (resData.uid !== uid && userRole !== 'admin') {
                throw new Error("❌ Unauthorized: You can only cancel your own bookings.");
            }

            // 3. Update Facility Capacity (Free up the spot!)
            const facilityQuery = await t.get(db.collection('facilities').where('name', '==', resData.facility).limit(1));
            
            if (!facilityQuery.empty) {
                const facilityDoc = facilityQuery.docs[0];
                const currentOcc = facilityDoc.data().currentOccupancy || 0;
                // Ensure we don't go below zero
                const newOcc = currentOcc > 0 ? currentOcc - 1 : 0;
                
                t.update(facilityDoc.ref, { currentOccupancy: newOcc });
            }

            // 4. Delete the Reservation
            t.delete(resRef);
        });

        res.json({ success: true, message: "Booking cancelled successfully" });

    } catch (error) {
        console.error("Cancel Error:", error.message);
        res.status(500).json({ message: error.message });
    }
});


const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});