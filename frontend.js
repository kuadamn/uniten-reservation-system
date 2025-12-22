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
const API_URL = ""; 
let currentUserToken = null; 
let currentFullSlots = []; 
let allFacilitiesData = [];

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
async function loadFacilities() {
    const typeSelect = document.getElementById('facilityType');
    const unitSelect = document.getElementById('facility'); 
    const unitContainer = document.getElementById('unitContainer');
    const endTimeInput = document.getElementById('endTime');

    unitContainer.classList.add('hidden');
    unitSelect.innerHTML = '';

    try {
        const response = await fetch(`${API_URL}/facilities`, { 
            headers: { 'Authorization': `Bearer ${currentUserToken}` } 
        });
        
        allFacilitiesData = await response.json();
        const types = [...new Set(allFacilitiesData.map(f => f.type))];
        const currentSelection = typeSelect.value; 

        typeSelect.innerHTML = '<option value="">-- Choose Facility Type --</option>';
        types.forEach(t => typeSelect.innerHTML += `<option value="${t}">${t}</option>`);

        if(currentSelection) typeSelect.value = currentSelection;

        const newTypeSelect = typeSelect.cloneNode(true);
        typeSelect.parentNode.replaceChild(newTypeSelect, typeSelect);
        
        newTypeSelect.addEventListener('change', () => {
            const selectedType = newTypeSelect.value;
            unitSelect.innerHTML = ''; 
            
            document.getElementById('startTime').value = "";
            endTimeInput.value = "";
            
            endTimeInput.disabled = true; 
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
                startAvailabilityPolling();
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
    } catch (err) { console.error("Error loading facilities:", err); }
}

async function checkAvailability() {
    const facility = document.getElementById('facility').value;
    const date = document.getElementById('date').value;
    const startSelect = document.getElementById('startTime');

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

function updateEndTimeAvailability() {
    const startVal = document.getElementById('startTime').value;
    const endSelect = document.getElementById('endTime');
    
    if (!startVal) {
        endSelect.disabled = true;
        endSelect.value = "";
        endSelect.classList.add('bg-gray-200', 'cursor-not-allowed', 'text-gray-500');
        return;
    }

    endSelect.disabled = false;
    endSelect.classList.remove('bg-gray-200', 'cursor-not-allowed', 'text-gray-500');
    endSelect.classList.add('bg-gray-50', 'text-gray-900');

    Array.from(endSelect.options).forEach(opt => {
        opt.disabled = false;
        opt.textContent = opt.textContent.replace(' - UNAVAILABLE', '');
        opt.classList.remove('bg-gray-200', 'text-gray-400');
    });

    if (endSelect.value && endSelect.value <= startVal) endSelect.value = "";

    let nextBusySlot = null;
    currentFullSlots.sort();

    for (let slot of currentFullSlots) {
        if (slot >= startVal) {
            nextBusySlot = slot;
            break;
        }
    }

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

document.getElementById('startTime').addEventListener('change', updateEndTimeAvailability);

// --- REAL-TIME AVAILABILITY POLLING ---
let pollingInterval = null;

function startAvailabilityPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    const poll = async () => {
        const facility = document.getElementById('facility').value;
        const date = document.getElementById('date').value;
        if (facility && date) {
            await checkAvailability();
        }
    };

    poll();
    pollingInterval = setInterval(poll, 5000);
}

document.getElementById('date').addEventListener('change', startAvailabilityPolling);
document.getElementById('facility').addEventListener('change', startAvailabilityPolling);

document.getElementById('logoutBtn').addEventListener('click', () => {
    if (pollingInterval) clearInterval(pollingInterval);
    signOut(auth);
});


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

// 4. USER PROFILE & ADMIN LOGIC
async function loadUserProfile() {
    try {
        const response = await fetch(`${API_URL}/my-profile`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        const data = await response.json();
        
        const nameField = document.getElementById('studentName');
        const idField = document.getElementById('studentId');
        
        if(nameField) nameField.value = data.name || "New Student";
        if(idField) idField.value = data.studentId || data.email;

        // --- ROLE BASED VIEW SWITCHING ---
        const adminPanel = document.getElementById('adminPanel');
        const leftColumn = document.getElementById('leftColumn');   // <--- New ID
        const rightColumn = document.getElementById('rightColumn'); // <--- New ID

        if (data.role === 'admin') {
            document.body.classList.add('admin-mode');
            
            // SHOW Admin Panel
            if(adminPanel) adminPanel.classList.remove('hidden');
            
            // HIDE Left Sidebar (Search & Booking)
            if(leftColumn) leftColumn.classList.add('hidden');

            // EXPAND Right Column (Database) to Full Width
            if(rightColumn) {
                rightColumn.classList.remove('lg:col-span-2');
                rightColumn.classList.add('lg:col-span-3');
            }
            
            loadAdminControls(); 
        } else {
            document.body.classList.remove('admin-mode');
            
            // HIDE Admin Panel
            if(adminPanel) adminPanel.classList.add('hidden');
            
            // SHOW Left Sidebar
            if(leftColumn) leftColumn.classList.remove('hidden');

            // RESET Right Column Width
            if(rightColumn) {
                rightColumn.classList.add('lg:col-span-2');
                rightColumn.classList.remove('lg:col-span-3');
            }
        }
    } catch (error) { console.error("Profile Error:", error); }
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
                    <td class="px-6 py-4 text-sm text-gray-500 font-mono font-bold pl-10">${fac.currentOccupancy} Active</td>
                    <td class="px-6 py-4"><span class="px-2 py-1 text-xs font-bold rounded-full ${statusClass}">${fac.status}</span></td>
                    <td class="px-6 py-4 text-right flex justify-end gap-2">
                        <button onclick="toggleFacilityStatus('${fac.name}', '${nextStatus}')" class="px-3 py-1 text-xs font-bold uppercase rounded transition ${btnClass}">
                            ${btnText}
                        </button>
                        <button onclick="deleteFacility('${fac.id}')" class="px-3 py-1 text-xs font-bold uppercase rounded text-gray-500 hover:bg-gray-100 hover:text-red-600 transition">
                            🗑
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

window.deleteFacility = async (id) => {
    if(!confirm("⚠️ Are you sure you want to delete this facility? This action cannot be undone.")) return;

    try {
        const response = await fetch(`${API_URL}/admin/delete-facility/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentUserToken}` }
        });

        if (response.ok) {
            alert("Facility deleted.");
            loadAdminControls(); // Refresh List
        } else {
            alert("Failed to delete.");
        }
    } catch (e) { console.error(e); }
};

// Admin Add Facility Handler
const addFacForm = document.getElementById('addFacilityForm');
if (addFacForm) {
    const newForm = addFacForm.cloneNode(true);
    addFacForm.parentNode.replaceChild(newForm, addFacForm);

    newForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('newFacName').value;
        const type = document.getElementById('newFacType').value;
        const maxCap = parseInt(document.getElementById('newFacCap').value);
        const submitBtn = newForm.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.textContent = "Adding...";

        try {
            const response = await fetch(`${API_URL}/admin/add-facility`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentUserToken}` },
                body: JSON.stringify({ name, type, maxCapacity: maxCap })
            });
            
            if (response.ok) {
                document.getElementById('addFacilityModal').classList.add('hidden');
                newForm.reset();
                loadAdminControls(); 
                alert("✅ Facility Added Successfully!");
            } else {
                const data = await response.json();
                alert("Failed: " + (data.message || "Unknown error"));
            }
        } catch (err) { console.error(err); alert("Network Error"); }
        finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Add";
        }
    });
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

// 7. NEW SEARCH & ADMIN LISTENERS

const searchBtn = document.getElementById('searchBtn');
if (searchBtn) {
    searchBtn.addEventListener('click', performSearch);
}

const searchInput = document.getElementById('facilitySearch');
if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });
}

async function performSearch() {
    const query = document.getElementById('facilitySearch').value.toLowerCase();
    const status = document.getElementById('statusFilter').value;
    const resultsArea = document.getElementById('searchResultsArea');
    const resultsList = document.getElementById('resultsList');

    resultsArea.classList.remove('hidden');
    resultsList.innerHTML = '<p class="text-gray-400 text-sm text-center animate-pulse">Searching...</p>';

    try {
        if (allFacilitiesData.length === 0) {
            const response = await fetch(`${API_URL}/facilities`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
            allFacilitiesData = await response.json();
        }

        const filtered = allFacilitiesData.filter(fac => {
            const matchName = fac.name.toLowerCase().includes(query) || fac.type.toLowerCase().includes(query);
            const matchStatus = status ? fac.status === status : true;
            return matchName && matchStatus;
        });

        if (filtered.length === 0) {
            resultsList.innerHTML = '<p class="text-red-400 text-sm text-center">No facilities found.</p>';
            return;
        }

        resultsList.innerHTML = filtered.map(fac => `
            <div onclick="selectFacility('${fac.type}', '${fac.name}')" 
                 class="p-3 border border-gray-100 rounded-lg hover:bg-blue-50 cursor-pointer transition flex justify-between items-center group">
                <div>
                    <p class="font-bold text-gray-800 text-sm">${fac.name}</p>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${fac.type}</span>
                        ${fac.status !== 'Open' ? '<span class="text-xs text-red-600 font-bold uppercase">Closed</span>' : ''}
                    </div>
                </div>
                <button class="text-xs bg-white border border-gray-200 px-3 py-1.5 rounded text-blue-600 font-medium group-hover:bg-blue-600 group-hover:text-white transition">
                    Book
                </button>
            </div>
        `).join('');

    } catch (error) {
        console.error(error);
        resultsList.innerHTML = '<p class="text-red-500 text-sm">Error loading results</p>';
    }
}

window.selectFacility = (type, specificName) => {
    const typeSelect = document.getElementById('facilityType');
    typeSelect.value = type;
    
    const event = new Event('change');
    typeSelect.dispatchEvent(event);

    setTimeout(() => {
        const unitSelect = document.getElementById('facility');
        if (unitSelect && !unitSelect.parentElement.classList.contains('hidden')) {
            unitSelect.value = specificName;
            unitSelect.dispatchEvent(new Event('change'));
        }
        
        const formContainer = document.getElementById('studentView');
        formContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        formContainer.classList.add('ring-2', 'ring-yellow-400');
        setTimeout(() => formContainer.classList.remove('ring-2', 'ring-yellow-400'), 1000);
    }, 150); 
};

window.filterAdminReservations = async () => {
    const query = document.getElementById('adminSearchInput').value.toLowerCase();
    const date = document.getElementById('adminDateFilter').value;
    
    try {
        const response = await fetch(`${API_URL}/reservations`, { headers: { 'Authorization': `Bearer ${currentUserToken}` } });
        const allBookings = await response.json();
        
        const filtered = allBookings.filter(b => {
            const matchesText = b.studentId.toLowerCase().includes(query) || b.facility.toLowerCase().includes(query);
            const matchesDate = date ? b.date === date : true;
            return matchesText && matchesDate && b.status === 'confirmed'; 
        });

        renderMainList(filtered, document.getElementById('reservationList'));
    } catch (e) { console.error(e); }
};