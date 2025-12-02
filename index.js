const express = require('express');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./key.json');

// --- CONFIGURATION ---
const PROJECT_ID = serviceAccount.project_id;

console.log(`--------------------------------------------------`);
console.log(`🔐 Loaded Key for Project: ${PROJECT_ID}`);
console.log(`--------------------------------------------------`);

// 1. Initialize Firebase
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

// --- ROUTES ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// [NEW] EMERGENCY RESET TOOL
// Run this to restore both Facilities and Reservations data
app.post('/reset-system', async (req, res) => {
    const batch = db.batch();

    // 1. Restore Facilities
    const facilities = [
        { id: 'badminton-a', name: 'Badminton Court A', maxCapacity: 4, currentOccupancy: 1, status: 'Open' },
        { id: 'badminton-b', name: 'Badminton Court B', maxCapacity: 4, currentOccupancy: 0, status: 'Open' },
        { id: 'pool', name: 'Swimming Pool', maxCapacity: 30, currentOccupancy: 5, status: 'Open' },
        { id: 'football', name: 'Football Field', maxCapacity: 22, currentOccupancy: 0, status: 'Maintenance' },
        { id: 'discussion-1', name: 'Discussion Room 1', maxCapacity: 6, currentOccupancy: 1, status: 'Open' }
    ];

    facilities.forEach(fac => {
        const docRef = db.collection('facilities').doc(fac.id);
        batch.set(docRef, fac);
    });

    // 2. Restore Dummy Reservations (so the list isn't empty)
    const dummyRes1 = db.collection('reservations').doc();
    batch.set(dummyRes1, {
        studentId: 'SW01081337',
        facility: 'Badminton Court A',
        date: '2023-12-05',
        time: '10:00',
        status: 'confirmed',
        createdAt: new Date()
    });

    const dummyRes2 = db.collection('reservations').doc();
    batch.set(dummyRes2, {
        studentId: 'SW02299881',
        facility: 'Swimming Pool',
        date: '2023-12-06',
        time: '14:00',
        status: 'confirmed',
        createdAt: new Date()
    });

    await batch.commit();
    console.log("✅ SYSTEM RESET: Facilities and Reservations restored.");
    res.send("✅ Database Restored Successfully!");
});

// 2. Get All Facilities
app.get('/facilities', async (req, res) => {
    try {
        const snapshot = await db.collection('facilities').get();
        const facilities = [];
        snapshot.forEach(doc => facilities.push(doc.data()));
        res.json(facilities);
    } catch(error) {
        res.status(500).send(error.message);
    }
});

// 3. Create Reservation
app.post('/reserve', async (req, res) => {
  try {
    const { studentId, facility, date, time } = req.body;
    console.log(`Attempting to book ${facility}...`);

    await db.runTransaction(async (t) => {
        // A. Check Facility
        const facilityQuery = await t.get(db.collection('facilities').where('name', '==', facility).limit(1));
        if (facilityQuery.empty) throw new Error("Facility not found!");

        const facilityDoc = facilityQuery.docs[0];
        const facilityData = facilityDoc.data();

        // B. Check Capacity
        if (facilityData.currentOccupancy >= facilityData.maxCapacity) {
            throw new Error("❌ Booking Failed: Facility is Full!");
        }

        // C. Update Capacity
        t.update(facilityDoc.ref, { currentOccupancy: facilityData.currentOccupancy + 1 });

        // D. Create Reservation
        const newReservationRef = db.collection('reservations').doc();
        t.set(newReservationRef, {
            studentId, facility, date, time, status: 'confirmed', createdAt: new Date()
        });
        
        res.reservationId = newReservationRef.id;
    });

    console.log(`✅ Success! ID: ${res.reservationId}`);
    res.status(200).json({ success: true, reservationId: res.reservationId });

  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).send({ message: error.message });
  }
});

// 4. Get Reservations
app.get('/reservations', async (req, res) => {
    try {
        const snapshot = await db.collection('reservations').orderBy('createdAt', 'desc').get();
        const bookings = [];
        snapshot.forEach(doc => bookings.push({ id: doc.id, ...doc.data() }));
        res.status(200).json(bookings);
    } catch(error) {
        res.status(500).send(error.message);
    }
});

const PORT = 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});