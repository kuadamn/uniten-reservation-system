import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDB0uJiwF2etHwaNdHujoui5K4LdnMMKpA",
  authDomain: "uniten-fac-res-sys.firebaseapp.com",
  projectId: "uniten-fac-res-sys",
  storageBucket: "uniten-fac-res-sys.firebasestorage.app",
  messagingSenderId: "112728359416",
  appId: "1:112728359416:web:06d226d46db058d669160d",
  measurementId: "G-Y2YYPNDW0W"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const API_URL = "http://localhost:8080"; 
let currentUserToken = null; 
let currentFullSlots = []; 

// UI Elements
const authContainer = document.getElementById('authContainer');
const appContent = document.getElementById('appContent');
const loginForm = document.getElementById('loginForm');

// 1. AUTHENTICATION
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserToken = await user.getIdToken();
        authContainer.classList.add('hidden');
        appContent.classList.remove('hidden');

        await loadUserProfile(); 
        populateTimeSelects(); 
        loadFacilities();
        fetchReservations();
    } else {
        currentUserToken = null;
        authContainer.classList.remove('hidden');
        appContent.classList.add('hidden');
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        await signInWithEmailAndPassword(auth, email, password);
        document.getElementById('loginError').classList.add('hidden');
    } catch (error) {
        const errorMsg = document.getElementById('loginError');
        errorMsg.textContent = "Login Failed: " + error.message;
        errorMsg.classList.remove('hidden');
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

// 2. FACILITY & AVAILABILITY LOGIC
let allFacilitiesData = [];

async function loadFacilities() {
    const typeSelect = document.getElementById('facilityType');
    const unitSelect = document.getElementById('facility'); 
    const unitContainer = document.getElementById('unitContainer');
    const endTimeInput = document.getElementById('endTime');

    unitContainer.classList.add('hidden');
    unitSelect.innerHTML = '';
    typeSelect.value = ''; 

    try {
        const response = await fetch(`${API_URL}/facilities`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        allFacilitiesData = await response.json();
        const types = [...new Set(allFacilitiesData.map(f => f.type))];
        typeSelect.innerHTML = '<option value="">-- Choose Facility Type --</option>';
        types.forEach(t => typeSelect.innerHTML += `<option value="${t}">${t}</option>`);

        const newTypeSelect = typeSelect.cloneNode(true);
        typeSelect.parentNode.replaceChild(newTypeSelect, typeSelect);
        
        newTypeSelect.addEventListener('change', () => {
            const selectedType = newTypeSelect.value;
            unitSelect.innerHTML = ''; 
            
            // [FIX] Reset Time Inputs
            document.getElementById('startTime').value = "";
            endTimeInput.value = "";
            
            // [FIX] End Time is Visible but DISABLED initially
            endTimeInput.disabled = true; 
            endTimeInput.required = true;
            endTimeInput.classList.add('bg-gray-200', 'cursor-not-allowed', 'text-gray-500');
            endTimeInput.classList.remove('bg-gray-50', 'text-gray-900');

            if (!selectedType) {
                unitContainer.classList.add('hidden');
                return;
            }

            let matching = allFacilitiesData.filter(f => f.type === selectedType);
            matching.sort((a, b) => a.label.localeCompare(b.label));

            if (matching.length === 1) {
                unitSelect.innerHTML = `<option value="${matching[0].name}" selected>${matching[0].name}</option>`;
                unitContainer.classList.add('hidden');
                checkAvailability(); 
            } else {
                unitContainer.classList.remove('hidden');
                unitSelect.innerHTML = '<option value="">-- Select Specific Unit --</option>';
                matching.forEach(fac => {
                    const isClosed = fac.status !== 'Open';
                    unitSelect.innerHTML += `<option value="${fac.name}" ${isClosed ? 'disabled' : ''}>
                        ${fac.label} ${isClosed ? '(MAINTENANCE)' : ''}
                    </option>`;
                });
            }
        });
    } catch (err) { console.error(err); }
}

// REAL-TIME CHECKER
async function checkAvailability() {
    const facility = document.getElementById('facility').value;
    const date = document.getElementById('date').value;
    const startSelect = document.getElementById('startTime');

    // Reset Start Time visuals
    Array.from(startSelect.options).forEach(opt => {
        opt.disabled = false;
        if(opt.textContent.includes(' - FULL')) {
            opt.textContent = opt.textContent.replace(' - FULL', '');
        }
        opt.classList.remove('bg-gray-200', 'text-gray-400');
    });

    if (!facility || !date) return;

    try {
        const response = await fetch(`${API_URL}/availability?facility=${encodeURIComponent(facility)}&date=${date}`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        currentFullSlots = await response.json(); 

        // Gray out full slots
        Array.from(startSelect.options).forEach(opt => {
            if (currentFullSlots.includes(opt.value)) {
                opt.disabled = true;
                opt.textContent += ' - FULL';
                opt.classList.add('bg-gray-200', 'text-gray-400');
            }
        });

        updateEndTimeAvailability();

    } catch (error) { console.error(error); }
}

// [UPDATED] Helper to Unlock End Time
function updateEndTimeAvailability() {
    const startVal = document.getElementById('startTime').value;
    const endSelect = document.getElementById('endTime');
    
    // 1. If No Start Time -> Keep End Time Disabled
    if (!startVal) {
        endSelect.disabled = true;
        endSelect.value = "";
        endSelect.classList.add('bg-gray-200', 'cursor-not-allowed', 'text-gray-500');
        return;
    }

    // 2. If Start Time Picked -> Unlock End Time
    endSelect.disabled = false;
    endSelect.classList.remove('bg-gray-200', 'cursor-not-allowed', 'text-gray-500');
    endSelect.classList.add('bg-gray-50', 'text-gray-900');

    // Reset visuals
    Array.from(endSelect.options).forEach(opt => {
        opt.disabled = false;
        opt.textContent = opt.textContent.replace(' - UNAVAILABLE', '');
        opt.classList.remove('bg-gray-200', 'text-gray-400');
    });

    if (endSelect.value && endSelect.value <= startVal) endSelect.value = "";

    // 3. Find limits based on occupied slots
    let nextBusySlot = null;
    currentFullSlots.sort();

    for (let slot of currentFullSlots) {
        if (slot >= startVal) {
            nextBusySlot = slot;
            break;
        }
    }

    // 4. Disable invalid options
    Array.from(endSelect.options).forEach(opt => {
        if (!opt.value) return;

        if (opt.value <= startVal) {
            opt.disabled = true;
            opt.classList.add('bg-gray-200', 'text-gray-400');
        } 
        else if (nextBusySlot && opt.value > nextBusySlot) {
            opt.disabled = true;
            opt.textContent += ' - UNAVAILABLE';
            opt.classList.add('bg-gray-200', 'text-gray-400');
        }
    });
}

// Triggers
document.getElementById('date').addEventListener('change', checkAvailability);
document.getElementById('facility').addEventListener('change', checkAvailability);
document.getElementById('startTime').addEventListener('change', updateEndTimeAvailability);


// 3. BOOKING SUBMISSION
document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusDiv = document.getElementById('statusMessage');
    const submitBtn = document.querySelector('#bookingForm button[type="submit"]');

    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing...";
    statusDiv.textContent = "Checking Availability...";
    statusDiv.className = "mt-4 text-center text-blue-600 block bg-blue-50 p-2 rounded";

    const data = {
        facility: document.getElementById('facility').value,
        date: document.getElementById('date').value,
        startTime: document.getElementById('startTime').value, 
        endTime: document.getElementById('endTime').value        
    };

    try {
        const response = await fetch(`${API_URL}/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUserToken}` },
            body: JSON.stringify(data)
        });
        const result = await response.json();

        if (response.ok) {
            statusDiv.textContent = `✅ Request Sent! Status: PENDING`;
            statusDiv.className = "mt-4 text-center text-green-600 block font-bold bg-green-50 p-2 rounded";
            document.getElementById('bookingForm').reset();
            await loadUserProfile(); 
            populateTimeSelects();
            
            // Re-lock End Time after reset
            document.getElementById('endTime').disabled = true;
            document.getElementById('endTime').classList.add('bg-gray-200', 'cursor-not-allowed');

            fetchReservations(); 
            loadFacilities();
            setTimeout(() => statusDiv.classList.add('hidden'), 3000);
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        statusDiv.textContent = `❌ ${error.message}`;
        statusDiv.className = "mt-4 text-center text-red-600 block font-bold bg-red-50 p-2 rounded";
    } finally {
        setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit Request";
        }, 2000);
    }
});

// 4. USER PROFILE & ADMIN
async function loadUserProfile() {
    try {
        const response = await fetch(`${API_URL}/my-profile`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        const data = await response.json();
        
        const nameField = document.getElementById('studentName');
        const idField = document.getElementById('studentId');
        
        if(nameField) nameField.value = data.name || "New Student";
        if(idField) idField.value = data.studentId || data.email;

        if (data.role === 'admin') {
            document.body.classList.add('admin-mode');
            document.getElementById('adminPanel').classList.remove('hidden');
            document.getElementById('studentView').classList.add('hidden');
            loadAdminControls(); 
        } else {
            document.body.classList.remove('admin-mode');
            document.getElementById('adminPanel').classList.add('hidden');
            document.getElementById('studentView').classList.remove('hidden');
        }
    } catch (error) { console.error(error); }
}

async function loadAdminControls() {
    const listTbody = document.getElementById('adminFacilityList');
    if(!listTbody) return;

    try {
        const response = await fetch(`${API_URL}/facilities`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        const facilities = await response.json();
        facilities.sort((a, b) => a.name.localeCompare(b.name));

        let totalCap = 0, usedCap = 0;

        listTbody.innerHTML = facilities.map(fac => {
            totalCap += fac.maxCapacity;
            usedCap += fac.currentOccupancy;
            const isClosed = fac.status !== 'Open';
            const statusClass = isClosed ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50';
            const btnClass = isClosed ? 'text-green-600 hover:bg-green-100' : 'text-red-600 hover:bg-red-100';
            const btnText = isClosed ? 'Enable' : 'Disable';
            const nextStatus = isClosed ? 'Open' : 'Maintenance';

            return `
                <tr class="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td class="px-6 py-4 font-bold text-gray-700">${fac.name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${fac.type}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 font-mono">${fac.currentOccupancy} / ${fac.maxCapacity}</td>
                    <td class="px-6 py-4"><span class="px-2 py-1 text-xs font-bold rounded-full ${statusClass}">${fac.status}</span></td>
                    <td class="px-6 py-4 text-right">
                        <button onclick="toggleFacilityStatus('${fac.name}', '${nextStatus}')" class="px-3 py-1 text-xs font-bold uppercase rounded transition ${btnClass}">
                            ${btnText}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        const percentage = totalCap > 0 ? Math.round((usedCap / totalCap) * 100) : 0;
        document.getElementById('statOccupancyTxt').innerText = percentage + "%";
        document.getElementById('statOccupancyBar').style.width = percentage + "%";
    } catch (e) { console.error(e); }
}

// 5. RESERVATIONS
async function fetchReservations() {
    try {
        const response = await fetch(`${API_URL}/reservations`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        const bookings = await response.json();
        
        const pendingTbody = document.getElementById('pendingList');
        const mainTbody = document.getElementById('reservationList');
        const isAdmin = document.body.classList.contains('admin-mode');

        if (isAdmin) {
            document.getElementById('statTotal').innerText = bookings.length;
            document.getElementById('statPending').innerText = bookings.filter(b => b.status === 'pending').length;

            const pending = bookings.filter(b => b.status === 'pending');
            const confirmed = bookings.filter(b => b.status !== 'pending');

            if (pending.length === 0) {
                pendingTbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-gray-400">No pending requests</td></tr>';
            } else {
                pendingTbody.innerHTML = pending.map(b => `
                    <tr class="hover:bg-yellow-50 transition border-b border-gray-100">
                        <td class="px-6 py-4 font-bold text-gray-800">${b.facility}</td>
                        <td class="px-6 py-4 text-sm">
                            <div class="font-medium">${b.studentName}</div>
                            <div class="text-xs text-gray-500">${b.studentId}</div>
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-600">${b.date} <br/> ${formatTime(b.startTime, b.endTime)}</td>
                        <td class="px-6 py-4 text-right space-x-2">
                            <button onclick="window.approveBooking('${b.id}')" class="text-green-600 font-bold text-xs bg-green-100 px-3 py-1.5 rounded">✔ Approve</button>
                            <button onclick="window.cancelBooking('${b.id}')" class="text-red-600 font-bold text-xs bg-red-100 px-3 py-1.5 rounded">✖ Reject</button>
                        </td>
                    </tr>
                `).join('');
            }
            renderMainList(confirmed, mainTbody);
        } else {
            renderMainList(bookings, mainTbody);
        }
    } catch (e) { console.error(e); }
}

function renderMainList(data, container) {
    if (data.length === 0) {
        container.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400">No history found.</td></tr>';
        return;
    }
    container.innerHTML = data.map(b => {
        let statusBadge = b.status === 'pending' 
            ? '<span class="bg-yellow-100 text-yellow-800 text-xs px-2.5 py-0.5 rounded-full font-bold">⏳ Pending</span>' 
            : '<span class="bg-green-100 text-green-800 text-xs px-2.5 py-0.5 rounded-full font-bold">✅ Confirmed</span>';
        
        return `
        <tr class="hover:bg-gray-50 transition border-b border-gray-50 last:border-0">
            <td class="px-6 py-4 font-medium text-gray-800">${b.facility}</td>
            <td class="px-6 py-4 text-sm text-gray-600">${b.studentName}</td>
            <td class="px-6 py-4 text-sm text-gray-600">${b.date} @ ${formatTime(b.startTime, b.endTime)}</td>
            <td class="px-6 py-4 text-center">${statusBadge}</td>
            <td class="px-6 py-4 text-right">
                <button onclick="window.cancelBooking('${b.id}')" class="text-gray-400 hover:text-red-600 font-bold text-xl">×</button>
            </td>
        </tr>
    `}).join('');
}

// 6. HELPERS
function populateTimeSelects() {
    const startSelect = document.getElementById('startTime');
    const endSelect = document.getElementById('endTime');
    
    startSelect.innerHTML = '<option value="">-- Select --</option>';
    endSelect.innerHTML = '<option value="">-- Select --</option>';

    const startHour = 8;
    const endHour = 22;

    for (let i = startHour; i <= endHour; i++) {
        const timeVal = i.toString().padStart(2, '0') + ":00";
        const label = convertTo12Hour(timeVal);
        if (i < endHour) startSelect.innerHTML += `<option value="${timeVal}">${label}</option>`;
        if (i > startHour) endSelect.innerHTML += `<option value="${timeVal}">${label}</option>`;
    }
}

function formatTime(start, end) {
    return `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`;
}
function convertTo12Hour(time24) {
    if (!time24) return "";
    const [hours, minutes] = time24.split(':');
    let h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; h = h ? h : 12; 
    return `${h}:${minutes} ${ampm}`;
}

window.approveBooking = async (id) => {
    try {
        const response = await fetch(`${API_URL}/admin/approve/${id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        if (response.ok) { fetchReservations(); loadAdminControls(); }
    } catch (e) { console.error(e); }
};
window.cancelBooking = async (reservationId) => {
    if (!confirm("Are you sure?")) return;
    try {
        const response = await fetch(`${API_URL}/cancel/${reservationId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        if (response.ok) { loadFacilities(); fetchReservations(); loadAdminControls(); checkAvailability(); }
    } catch (error) { console.error(error); }
};
window.toggleFacilityStatus = async (name, newStatus) => {
    if(!confirm(`Change ${name} to ${newStatus}?`)) return;
    try {
        const response = await fetch(`${API_URL}/admin/update-facility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUserToken}` },
            body: JSON.stringify({ facilityName: name, newStatus: newStatus })
        });
        if (response.ok) { loadAdminControls(); fetchReservations(); }
    } catch(e) { alert("Error connecting to server"); }
};