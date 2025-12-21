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

// UI Elements
const authContainer = document.getElementById('authContainer');
const appContent = document.getElementById('appContent');
const loginForm = document.getElementById('loginForm');

// AUTHENTICATION
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUserToken = await user.getIdToken();
        authContainer.classList.add('hidden');
        appContent.classList.remove('hidden');
        await loadUserProfile(); 
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

// FACILITY LOADING
let allFacilitiesData = [];
async function loadFacilities() {
    const typeSelect = document.getElementById('facilityType');
    const unitSelect = document.getElementById('facility'); 
    const unitContainer = document.getElementById('unitContainer');

    unitContainer.classList.add('hidden');
    unitSelect.innerHTML = '';
    typeSelect.value = ''; 

    try {
        const response = await fetch(`${API_URL}/facilities`, {
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        allFacilitiesData = await response.json();
        
        const types = [...new Set(allFacilitiesData.map(f => f.type))];
        typeSelect.innerHTML = '<option value="">-- Choose Facility Type --</option>';
        types.forEach(t => typeSelect.innerHTML += `<option value="${t}">${t}</option>`);

        const newTypeSelect = typeSelect.cloneNode(true);
        typeSelect.parentNode.replaceChild(newTypeSelect, typeSelect);
        
        newTypeSelect.addEventListener('change', () => {
            const selectedType = newTypeSelect.value;
            unitSelect.innerHTML = ''; 
            if (!selectedType) {
                unitContainer.classList.add('hidden');
                return;
            }
            let matching = allFacilitiesData.filter(f => f.type === selectedType);
            matching.sort((a, b) => a.label.localeCompare(b.label));

            if (matching.length === 1) {
                unitSelect.innerHTML = `<option value="${matching[0].name}" selected>${matching[0].name}</option>`;
                unitContainer.classList.add('hidden');
            } else {
                unitContainer.classList.remove('hidden');
                unitSelect.innerHTML = '<option value="">-- Select Specific Unit --</option>';
                matching.forEach(fac => {
                    const isFull = fac.currentOccupancy >= fac.maxCapacity;
                    const disabled = isFull || fac.status !== 'Open' ? 'disabled' : '';
                    const label = `${fac.label} (${fac.currentOccupancy}/${fac.maxCapacity}) ${disabled ? '- FULL/CLOSED' : ''}`;
                    unitSelect.innerHTML += `<option value="${fac.name}" ${disabled}>${label}</option>`;
                });
            }
        });
    } catch (err) { console.error(err); }
}

// BOOKING SUBMISSION
document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const statusDiv = document.getElementById('statusMessage');
    const submitBtn = document.querySelector('#bookingForm button[type="submit"]');

    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing...";
    statusDiv.textContent = "Sending Request...";
    statusDiv.className = "mt-4 text-center text-blue-600 block bg-blue-50 p-2 rounded";

    const data = {
        facility: document.getElementById('facility').value,
        date: document.getElementById('date').value,
        time: document.getElementById('time').value
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
            
            // [FIX 1] Restore Name and ID immediately after reset
            await loadUserProfile(); 
            
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

// LOAD USER PROFILE
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

// ADMIN: LOAD TABLE
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

// RESERVATIONS LIST
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
                        <td class="px-6 py-4 text-sm text-gray-600">${b.date} @ ${b.time}</td>
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
            <td class="px-6 py-4 text-sm text-gray-600">${b.date} @ ${b.time}</td>
            <td class="px-6 py-4 text-center">${statusBadge}</td>
            <td class="px-6 py-4 text-right">
                <button onclick="window.cancelBooking('${b.id}')" class="text-gray-400 hover:text-red-600 font-bold text-xl">×</button>
            </td>
        </tr>
    `}).join('');
}

// GLOBAL ACTIONS
window.approveBooking = async (id) => {
    try {
        const response = await fetch(`${API_URL}/admin/approve/${id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        if (response.ok) { 
            fetchReservations(); 
            loadAdminControls(); // [FIX 2] Update capacity stats immediately
        }
    } catch (e) { console.error(e); }
};

window.cancelBooking = async (reservationId) => {
    if (!confirm("Are you sure?")) return;
    try {
        const response = await fetch(`${API_URL}/cancel/${reservationId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });
        if (response.ok) { 
            loadFacilities(); 
            fetchReservations();
            loadAdminControls(); // [FIX 2] Update capacity stats immediately
        }
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
        if (response.ok) { 
            loadAdminControls(); 
            fetchReservations(); 
        }
    } catch(e) { alert("Error connecting to server"); }
};