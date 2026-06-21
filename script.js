// --- Globals & State ---
let db;
let currentTheme = localStorage.getItem('theme') || 'light';
let isOrganizer = localStorage.getItem('isOrganizer') === 'true';

// --- Initialization ---
document.documentElement.setAttribute('data-theme', currentTheme);
updateThemeIcon();
toggleViews();

const request = indexedDB.open("EventDB", 2); // Version 2 supports categories and emails

request.onupgradeneeded = function (event) {
    db = event.target.result;
    
    // Setup Events Store safely
    let eventStore;
    if (!db.objectStoreNames.contains("events")) {
        eventStore = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
    } else {
        eventStore = event.target.transaction.objectStore("events");
    }
    
    // Add indexes for Events if missing
    if(!eventStore.indexNames.contains("name")) {
        eventStore.createIndex("name", "name", { unique: false });
    }
    if(!eventStore.indexNames.contains("category")) {
        eventStore.createIndex("category", "category", { unique: false });
    }

    // Setup Registrations Store safely
    let regStore;
    if (!db.objectStoreNames.contains("registrations")) {
        regStore = db.createObjectStore("registrations", { keyPath: "id", autoIncrement: true });
    } else {
        regStore = event.target.transaction.objectStore("registrations");
    }
    
    // Add indexes for Registrations if missing
    if(!regStore.indexNames.contains("eventId")) {
        regStore.createIndex("eventId", "eventId", { unique: false });
    }
    if(!regStore.indexNames.contains("email")) {
        regStore.createIndex("email", "email", { unique: false });
    }
};

request.onsuccess = function (event) {
    db = event.target.result;
    refreshData();
};

request.onerror = function () {
    console.error("Database Initialization Error");
};

function refreshData() {
    loadPublicEvents();
    loadMyRegistrations();
    if(isOrganizer) {
        loadManageEvents();
    }
}

// --- Theme Toggle (Dark Mode) ---
document.getElementById('themeToggle').addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateThemeIcon();
});

function updateThemeIcon() {
    document.getElementById('themeToggle').textContent = currentTheme === 'light' ? '🌙' : '☀️';
}

// --- Local Storage Login ---
document.getElementById('loginBtn').addEventListener('click', () => {
    document.getElementById('loginModal').classList.remove('hidden');
    document.getElementById('loginPassword').focus();
});

document.getElementById('closeLoginBtn').addEventListener('click', closeLoginModal);

function closeLoginModal() {
    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('loginForm').reset();
}

document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const pwd = document.getElementById('loginPassword').value;
    if(pwd === 'admin123') {
        isOrganizer = true;
        localStorage.setItem('isOrganizer', 'true');
        closeLoginModal();
        toggleViews();
        refreshData();
    } else {
        alert('Incorrect password! Use "admin123".');
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    isOrganizer = false;
    localStorage.removeItem('isOrganizer');
    toggleViews();
});

function toggleViews() {
    const publicView = document.getElementById('publicView');
    const organizerView = document.getElementById('organizerView');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if(isOrganizer) {
        publicView.classList.add('hidden');
        organizerView.classList.remove('hidden');
        loginBtn.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
    } else {
        publicView.classList.remove('hidden');
        organizerView.classList.add('hidden');
        loginBtn.classList.remove('hidden');
        logoutBtn.classList.add('hidden');
    }
}

// --- Organizer: Manage Events ---
document.getElementById('eventForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const idStr = document.getElementById('editEventId').value;
    const name = document.getElementById('eventName').value.trim();
    const category = document.getElementById('eventCategory').value;
    const date = document.getElementById('eventDate').value;

    if(!name || !category || !date) {
        alert("Please fill out all fields");
        return;
    }

    const transaction = db.transaction(["events"], "readwrite");
    const store = transaction.objectStore("events");
    
    const eventObj = { name, category, date };
    
    if(idStr) {
        eventObj.id = parseInt(idStr);
        store.put(eventObj); // Edit Event
    } else {
        store.add(eventObj); // Add new Event
    }

    transaction.oncomplete = () => {
        resetEventForm();
        loadManageEvents();
    };
});

function resetEventForm() {
    document.getElementById('eventForm').reset();
    document.getElementById('editEventId').value = '';
    document.getElementById('formTitle').textContent = 'Create New Event';
    document.getElementById('saveEventBtn').textContent = 'Add Event';
    document.getElementById('cancelEditBtn').classList.add('hidden');
}

document.getElementById('cancelEditBtn').addEventListener('click', resetEventForm);

function editEvent(id, name, category, date) {
    document.getElementById('editEventId').value = id;
    document.getElementById('eventName').value = name;
    document.getElementById('eventCategory').value = category || 'Tech';
    document.getElementById('eventDate').value = date;
    
    document.getElementById('formTitle').textContent = 'Edit Event';
    document.getElementById('saveEventBtn').textContent = 'Update Event';
    document.getElementById('cancelEditBtn').classList.remove('hidden');
    
    // Smooth scroll to form
    document.getElementById('formTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function deleteEvent(id) {
    if(!confirm('Are you sure you want to delete this event? All registrations for it will also be lost.')) return;

    const tx = db.transaction(["events", "registrations"], "readwrite");
    tx.objectStore("events").delete(id);
    
    // Cascading delete for registrations related to this event
    const regStore = tx.objectStore("registrations");
    const regIndex = regStore.index("eventId");
    const request = regIndex.openCursor(IDBKeyRange.only(id));
    
    request.onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
            regStore.delete(cursor.primaryKey);
            cursor.continue();
        }
    };

    tx.oncomplete = () => {
        loadManageEvents();
        loadPublicEvents();
    };
}

function getRegistrationCount(eventId, callback) {
    const tx = db.transaction(["registrations"], "readonly");
    const index = tx.objectStore("registrations").index("eventId");
    const request = index.count(IDBKeyRange.only(eventId));
    request.onsuccess = () => callback(request.result);
}

function loadManageEvents() {
    const list = document.getElementById("manageEventList");
    list.innerHTML = "";
    
    const store = db.transaction(["events"], "readonly").objectStore("events");
    let hasEvents = false;
    
    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
            hasEvents = true;
            const ev = cursor.value;
            const cat = ev.category || 'General';

            getRegistrationCount(ev.id, (count) => {
                const div = document.createElement("div");
                div.className = "card glass fade-in";
                div.innerHTML = `
                    <span class="badge">${cat}</span>
                    <h3>${ev.name}</h3>
                    <p>📅 Date: ${ev.date}</p>
                    <p>👥 Registrations: <strong>${count}</strong></p>
                    <div class="card-actions">
                        <button class="btn-outline" onclick="editEvent(${ev.id}, '${ev.name.replace(/'/g, "\\'")}', '${cat}', '${ev.date}')">✏️ Edit</button>
                        <button class="btn-secondary" onclick="deleteEvent(${ev.id})">🗑️ Delete</button>
                    </div>
                `;
                list.appendChild(div);
            });
            cursor.continue();
        } else if(!hasEvents) {
            list.innerHTML = "<p style='color: var(--text-muted)'>No events created yet.</p>";
        }
    };
}

// --- Public: Event Search & Category Filter ---
document.getElementById('searchBar').addEventListener('input', loadPublicEvents);
document.getElementById('categoryFilter').addEventListener('change', loadPublicEvents);

function loadPublicEvents() {
    const list = document.getElementById("eventList");
    list.innerHTML = "";
    
    const searchTerm = document.getElementById('searchBar').value.toLowerCase();
    const filterCat = document.getElementById('categoryFilter').value;

    const store = db.transaction(["events"], "readonly").objectStore("events");
    let hasEvents = false;
    
    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
            const ev = cursor.value;
            const cat = ev.category || 'General';
            
            const matchSearch = ev.name.toLowerCase().includes(searchTerm);
            const matchCat = filterCat === 'All' || cat === filterCat;
            
            if(matchSearch && matchCat) {
                hasEvents = true;
                const div = document.createElement("div");
                div.className = "card glass fade-in";
                div.innerHTML = `
                    <span class="badge">${cat}</span>
                    <h3>${ev.name}</h3>
                    <p>📅 ${ev.date}</p>
                    <div class="card-actions">
                        <button class="btn-primary" onclick="openRegistrationModal(${ev.id}, '${ev.name.replace(/'/g, "\\'")}')">Register Now</button>
                    </div>
                `;
                list.appendChild(div);
            }
            cursor.continue();
        } else if(!hasEvents) {
            list.innerHTML = "<p style='color: var(--text-muted)'>No events found matching your criteria.</p>";
        }
    };
}

// --- Registration Logic ---
function openRegistrationModal(eventId, eventName) {
    document.getElementById('registerEventId').value = eventId;
    document.getElementById('modalEventName').textContent = eventName;
    document.getElementById('registrationModal').classList.remove('hidden');
    document.getElementById('regName').focus();
}

function closeRegistrationModal() {
    document.getElementById('registrationModal').classList.add('hidden');
    document.getElementById('registrationForm').reset();
}

document.getElementById('closeModalBtn').addEventListener('click', closeRegistrationModal);
document.getElementById('closeModalIcon').addEventListener('click', closeRegistrationModal);

document.getElementById('registrationForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const eventId = parseInt(document.getElementById('registerEventId').value);
    const username = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    
    // Store email in local storage to track "My Registrations" for this user
    const myEmails = JSON.parse(localStorage.getItem('myEmails') || '[]');
    if(!myEmails.includes(email)) {
        myEmails.push(email);
        localStorage.setItem('myEmails', JSON.stringify(myEmails));
    }

    const tx = db.transaction(["registrations"], "readwrite");
    tx.objectStore("registrations").add({ eventId, username, email });
    
    tx.oncomplete = () => {
        closeRegistrationModal();
        alert(`Successfully registered for ${document.getElementById('modalEventName').textContent}!`);
        loadMyRegistrations();
    };
});

// --- Public: My Registrations ---
function loadMyRegistrations() {
    const list = document.getElementById("registrationList");
    list.innerHTML = "";
    
    const myEmails = JSON.parse(localStorage.getItem('myEmails') || '[]');
    if(myEmails.length === 0) {
        list.innerHTML = "<p style='color: var(--text-muted)'>You haven't registered for any events from this device yet.</p>";
        return;
    }

    const tx = db.transaction(["events", "registrations"], "readonly");
    const regStore = tx.objectStore("registrations");
    const eventStore = tx.objectStore("events");
    
    let hasReg = false;

    regStore.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
            const reg = cursor.value;
            // Only show registrations matching emails used on this device
            if(myEmails.includes(reg.email)) {
                hasReg = true;
                
                // Fetch the associated event details
                eventStore.get(reg.eventId).onsuccess = (evReq) => {
                    const eventData = evReq.target.result;
                    const eventName = eventData ? eventData.name : "Deleted Event";
                    const eventDate = eventData ? eventData.date : "N/A";
                    const eventCat = eventData ? (eventData.category || 'General') : "N/A";
                    
                    const div = document.createElement("div");
                    div.className = "card glass fade-in";
                    div.innerHTML = `
                        <span class="badge" style="background: rgba(148, 163, 184, 0.2); color: var(--text-muted);">${eventCat}</span>
                        <h3>${eventName}</h3>
                        <p>📅 ${eventDate}</p>
                        <hr style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--glass-border);">
                        <p>👤 <strong>${reg.username}</strong></p>
                        <p>✉️ ${reg.email}</p>
                        <div class="card-actions">
                            <button class="btn-outline" style="color: var(--secondary-color); border-color: var(--secondary-color);" onclick="cancelRegistration(${reg.id})">Cancel Ticket</button>
                        </div>
                    `;
                    list.appendChild(div);
                };
            }
            cursor.continue();
        } else {
            // Once cursor finishes, if still false (which could happen asynchronously but practically here it works as synchronous dispatch)
            setTimeout(() => {
                if(list.children.length === 0) {
                     list.innerHTML = "<p style='color: var(--text-muted)'>You haven't registered for any events from this device yet.</p>";
                }
            }, 50);
        }
    };
}

function cancelRegistration(id) {
    if(!confirm('Are you sure you want to cancel your registration?')) return;
    const tx = db.transaction(["registrations"], "readwrite");
    tx.objectStore("registrations").delete(id);
    tx.oncomplete = () => loadMyRegistrations();
}

// --- Organizer: Export CSV ---
document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const tx = db.transaction(["events", "registrations"], "readonly");
    const regStore = tx.objectStore("registrations");
    const eventStore = tx.objectStore("events");
    
    const registrations = [];
    
    regStore.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor) {
            registrations.push(cursor.value);
            cursor.continue();
        } else {
            if(registrations.length === 0) {
                alert("No registrations found to export.");
                return;
            }
            
            let processed = 0;
            // CSV Header
            let csvContent = "data:text/csv;charset=utf-8,Registration ID,Event Name,User Name,Email\n";
            
            // Map event IDs to Event Names
            registrations.forEach(reg => {
                eventStore.get(reg.eventId).onsuccess = (evReq) => {
                    const eventData = evReq.target.result;
                    // Escape commas by removing them or wrapping in quotes (removing is simpler here)
                    const eventName = eventData ? eventData.name.replace(/,/g, '') : "Deleted Event";
                    const userName = reg.username.replace(/,/g, '');
                    
                    csvContent += `${reg.id},${eventName},${userName},${reg.email}\n`;
                    processed++;
                    
                    if(processed === registrations.length) {
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", "event_registrations.csv");
                        document.body.appendChild(link); // Required for FF
                        link.click();
                        document.body.removeChild(link); 
                    }
                };
            });
        }
    };
});
