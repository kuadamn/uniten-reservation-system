const express = require('express');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth'); 
const serviceAccount = require('./key.json');

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
        const snapshot = await db.collection('facilities').get();
        const facilities = [];
        snapshot.forEach(doc => facilities.push(doc.data()));
        res.json(facilities);
    } catch(error) { res.status(500).send(error.message); }
});

// CREATE RESERVATION (Holds the spot immediately)
app.post('/reserve', authenticateUser, async (req, res) => {
  try {
    const { facility, date, time } = req.body;
    const uid = req.user.uid; 

    await db.runTransaction(async (t) => {
        const userDoc = await t.get(db.collection('users').doc(uid));
        const userData = userDoc.exists ? userDoc.data() : {};

        // 1. Check Duplicates
        const duplicateQuery = await t.get(db.collection('reservations')
            .where('uid', '==', uid).where('facility', '==', facility).where('date', '==', date).where('time', '==', time));
        if (!duplicateQuery.empty) throw new Error("⚠️ You have already requested this slot!");

        // 2. Check Capacity
        const facilityQuery = await t.get(db.collection('facilities').where('name', '==', facility).limit(1));
        if (facilityQuery.empty) throw new Error("Facility not found!");
        const facilityDoc = facilityQuery.docs[0];
        
        if (facilityDoc.data().currentOccupancy >= facilityDoc.data().maxCapacity) {
            throw new Error("❌ Facility is Full!");
        }

        // 3. INCREMENT OCCUPANCY (Hold the spot)
        t.update(facilityDoc.ref, { currentOccupancy: facilityDoc.data().currentOccupancy + 1 });

        // 4. Create Pending Reservation
        const newRef = db.collection('reservations').doc();
        t.set(newRef, {
            uid: uid,
            studentName: userData.name || "Unknown",
            studentId: userData.studentId || req.user.email,
            facility, date, time, 
            status: 'pending', 
            createdAt: new Date()
        });
        res.reservationId = newRef.id;
    });

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

// ADMIN: APPROVE (Capacity already held, just change status)
app.post('/admin/approve/:id', authenticateUser, async (req, res) => {
    try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') return res.status(403).json({ message: "Unauthorized" });

        await db.collection('reservations').doc(req.params.id).update({ status: 'confirmed' });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ message: error.message }); }
});

// ADMIN: UPDATE FACILITY STATUS (Fix for Disable Button)
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

// CANCEL / REJECT (Decrements Capacity)
app.delete('/cancel/:id', authenticateUser, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const uid = req.user.uid;

        await db.runTransaction(async (t) => {
            const resRef = db.collection('reservations').doc(reservationId);
            const resDoc = await t.get(resRef);
            if (!resDoc.exists) throw new Error("Reservation not found");

            const resData = resDoc.data();
            
            // Check Admin Role
            const userDoc = await t.get(db.collection('users').doc(uid));
            const isAdmin = userDoc.exists && userDoc.data().role === 'admin';

            if (resData.uid !== uid && !isAdmin) throw new Error("Unauthorized");

            // FREE UP THE SPOT (Decrement)
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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
