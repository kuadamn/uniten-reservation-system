// 1. Import Firebase Functions
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ==========================================
// 2. PASTE YOUR FIREBASE CONFIG HERE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDB0uJiwF2etHwaNdHujoui5K4LdnMMKpA",
  authDomain: "uniten-fac-res-sys.firebaseapp.com",
  projectId: "uniten-fac-res-sys",
  storageBucket: "uniten-fac-res-sys.firebasestorage.app",
  messagingSenderId: "112728359416",
  appId: "1:112728359416:web:06d226d46db058d669160d",
  measurementId: "G-Y2YYPNDW0W"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const API_URL = "http://localhost:8080";
let currentUserToken = null; // Store token here

// UI Elements
const authContainer = document.getElementById('authContainer');
const appContent = document.getElementById('appContent');
const loginForm = document.getElementById('loginForm');
const logoutBtn = document.getElementById('logoutBtn');

// ----------------------------------------------------
// AUTHENTICATION LOGIC
// ----------------------------------------------------

// Listen for Login/Logout state changes
onAuthStateChanged(auth, async (user) => {
    // Inside onAuthStateChanged...
    if (user) {
        console.log("User logged in:", user.email);
        currentUserToken = await user.getIdToken();

        authContainer.classList.add('hidden');
        appContent.classList.remove('hidden');

        // [CHANGED] Load the detailed profile instead of just filling email
        loadUserProfile(); 
        
        loadFacilities();
        fetchReservations();
    
    } else {
        // --- LOGGED OUT ---
        console.log("User logged out");
        currentUserToken = null;

        // Switch UI
        authContainer.classList.remove('hidden');
        appContent.classList.add('hidden');
    }
});

// Handle Login Button
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorMsg = document.getElementById('loginError');

    try {
        await signInWithEmailAndPassword(auth, email, password);
        errorMsg.classList.add('hidden');
    } catch (error) {
        errorMsg.textContent = "Login Failed: " + error.message;
        errorMsg.classList.remove('hidden');
    }
});

// Handle Logout Button
logoutBtn.addEventListener('click', () => {
    signOut(auth);
});

// ----------------------------------------------------
// BOOKING LOGIC
// ----------------------------------------------------

async function loadFacilities() {
    const select = document.getElementById('facility');
    try {
        // WE NOW SEND THE TOKEN IN THE HEADER
        const response = await fetch(`${API_URL}/facilities`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        
        if(!response.ok) throw new Error("Auth Failed");

        const facilities = await response.json();
        select.innerHTML = '<option value="">-- Choose a Facility --</option>';

        facilities.forEach(fac => {
            const isFull = fac.currentOccupancy >= fac.maxCapacity;
            const label = `${fac.name} (${fac.currentOccupancy}/${fac.maxCapacity} Occupied)`;
            
            const option = document.createElement('option');
            option.value = fac.name;
            option.textContent = label;
            
            if (isFull || fac.status !== 'Open') {
                option.disabled = true;
                option.textContent += ` - ${fac.status === 'Open' ? 'FULL' : fac.status}`;
            }
            select.appendChild(option);
        });
    } catch (err) {
        console.error("Error loading facilities:", err);
    }
}

// [MODIFIED] Fetch Student Profile & Show Role
async function loadUserProfile() {
    const nameInput = document.getElementById('studentName');
    const idInput = document.getElementById('studentId');
    const headerTitle = document.querySelector('h1'); // Grab the main title

    try {
        const response = await fetch(`${API_URL}/my-profile`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const data = await response.json();

        nameInput.value = data.name || "Unknown Student";
        idInput.value = data.studentId || "No ID Found";

        // [NEW] Visual change for Admin
        if (data.role === 'admin') {
            headerTitle.textContent = "🛡️ UNITEN Admin Portal";
            document.body.classList.add('admin-mode'); // Optional: for CSS styling
            // You could also unhide a "Manage Facilities" button here later!
        } else {
            headerTitle.textContent = "🎓 UNITEN Facility Reservation";
        }
        
    } catch (error) {
        console.error("Profile Error:", error);
    }
}

document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.textContent = "Processing...";
    statusDiv.className = "mt-4 text-center text-blue-600 block";

    const data = {
        facility: document.getElementById('facility').value,
        date: document.getElementById('date').value,
        time: document.getElementById('time').value
    };

    try {
        const response = await fetch(`${API_URL}/reserve`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentUserToken}` // SEND TOKEN HERE
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();

        if (response.ok) {
            statusDiv.textContent = `✅ Success! Booking ID: ${result.reservationId}`;
            statusDiv.className = "mt-4 text-center text-green-600 block";
            fetchReservations(); 
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        statusDiv.textContent = `❌ Error: ${error.message}`;
        statusDiv.className = "mt-4 text-center text-red-600 block";
    }
});

async function fetchReservations() {
    try {
        const response = await fetch(`${API_URL}/reservations`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        const bookings = await response.json();
        const listDiv = document.getElementById('reservationList');
        
        if (bookings.length === 0) {
            listDiv.innerHTML = '<p class="text-gray-400 text-center">No bookings yet.</p>';
            return;
        }

        listDiv.innerHTML = bookings.map(b => `
            <div class="p-3 bg-gray-50 border-l-4 border-blue-500 rounded shadow-sm hover:shadow-md transition">
                <div class="flex justify-between items-center">
                    <div>
                        <div class="font-bold text-gray-800">${b.facility}</div>
                        <div class="text-sm font-semibold text-blue-900">
                            ${b.studentName || 'Unknown'} 
                            <span class="text-gray-500 font-normal">(${b.studentId})</span>
                        </div>
                        <div class="text-xs text-gray-500 mt-1">
                            📅 ${b.date} &nbsp; ⏰ ${convertTo12Hour(b.time)}
                        </div>
                    </div>
                    
                    <button onclick="window.cancelBooking('${b.id}')" 
                        class="bg-red-100 hover:bg-red-200 text-red-600 text-xs font-bold px-3 py-2 rounded border border-red-200 transition">
                        Cancel
                    </button>
                </div>
            </div>
        `).join('');
    } catch (e) { console.error(e); }
}

// [NEW] Helper to convert "14:00" -> "2:00 PM"
function convertTo12Hour(time24) {
    if (!time24) return "";
    const [hours, minutes] = time24.split(':');
    let h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    h = h ? h : 12; // the hour '0' should be '12'
    return `${h}:${minutes} ${ampm}`;
}

// [NEW] Cancel Booking Logic
window.cancelBooking = async (reservationId) => {
    if (!confirm("Are you sure you want to cancel this booking?")) return;

    try {
        const response = await fetch(`${API_URL}/cancel/${reservationId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });

        const result = await response.json();

        if (response.ok) {
            alert("✅ Booking Cancelled!");
            // Refresh data to show updated capacity and list
            loadFacilities();
            fetchReservations();
        } else {
            alert("❌ Failed: " + result.message);
        }
    } catch (error) {
        console.error("Cancel Error:", error);
        alert("System Error: Could not cancel.");
    }
};