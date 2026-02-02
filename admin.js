// Link to the same API
const ADMIN_API_URL = "https://script.google.com/macros/s/AKfycbxEn0_QHCdDmA24QNrXOfFVg2lSlvdt9R7opPpLmOrxEZGxm0L7t73CWneKlaHHo8ZV/exec";

// Global Error Handler for debugging
// Global Error Handler removed to prevent generic script errors from alerting
// window.onerror = ...

// Simple client-side password
const ADMIN_PASS = "82830476";

// --- Helper Functions for Safety Checks (Defined First) ---

window.isProfileDeducted = function (order) {
    return !!localStorage.getItem(`deducted_${order.timestamp}`);
};
window.setProfileDeducted = function (orderId) {
    localStorage.setItem(`deducted_${orderId}`, "true");
};

// --- Global Deduction Tools ---

/**
 * 取得與庫存表一致的鍵值名稱
 * @param {string} rawName - 原始名稱 (可能含標籤、長度、括號)
 * @param {number} series - 系列編號
 * @returns {string} - 標準化鍵值
 */
window.getInventoryKey = function (rawName, series) {
    let name = rawName.replace(/^【.*?】\s*/, '').trim();
    name = name.replace(/\(L=\d+cm\)/g, '').trim();
    name = name.replace(/\(長度\d+cm\)/g, '').trim();

    // 1. 鋁材名稱標準化
    if (name.includes("鋁擠型") || name.includes("鋁材") || name.match(/^\d{4}型/) || name.includes("輕型") || name.includes("重型")) {
        // 移除常見冗餘詞
        let simple = name.replace("歐規鋁擠型", "").replace("歐規封閉鋁擠型", "").replace("歐規雙封閉鋁擠型", "").replace("歐規", "").replace("鋁擠型", "").replace("鋁材", "").trim();

        // 處理 20 系列 (如 2020歐規... -> 2020型)
        if (simple.match(/^20\d{2}/)) {
            return simple.substring(0, 4) + "型";
        }

        // 處理 30/40 系列輕重型
        if (simple.includes("(輕量型)")) return simple.replace(" (輕量型)", "輕型").trim();
        if (simple.includes("(標準型)")) return simple.replace(" (標準型)", "重型").trim();

        // 處理已經是 "3030輕型" 格式的
        return simple;
    }

    // 2. 配件名稱標準化 (含螺絲)
    return window.convertToInventoryKey(name, series);
};


window.showPriceModal = function (order, nextStatus) {
    const modalBody = document.getElementById('modal-body');
    const modal = document.getElementById('modal');
    if (!modal || !modalBody) return;

    modalBody.innerHTML = `
        <div style="padding:20px; text-align:center;">
            <h3 style="color:#e67e22;"><i class="fas fa-calculator"></i> 準備移至「已報價」</h3>
            <p>請輸入運費金額 (若免運請填0)：</p>
            <input type="number" id="quote-shipping-input" value="0" style="font-size:1.5rem; padding:10px; width:200px; text-align:center; border:2px solid #ddd; border-radius:8px;">
            <div style="margin-top:20px; display:flex; justify-content:center; gap:10px;">
                 <button class="btn-secondary" onclick="closeModal()">取消</button>
                 <button class="btn-primary" onclick="confirmQuotePrice('${order.timestamp}', '${nextStatus}')" style="background:#e67e22;">確認並與報價</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    setTimeout(() => {
        const input = document.getElementById('quote-shipping-input');
        if (input) { input.focus(); input.select(); }
    }, 100);
};

// [New] Helper for detailed email body
window.generateMailBody = function (name, total, shippingFee, details) {
    let feeStr = (shippingFee > 0) ? `(含運費 ${shippingFee} 元)` : "(免運費)";
    if (shippingFee === 0 && (total === 0 || total === "0")) feeStr = ""; // Edge case

    // Format details: Replace \n or <br> with %0D%0A for mailto
    let formattedDetails = (details || "無詳細明細").replace(/\\n/g, '\n').replace(/\n/g, '\n');
    // Note: window.openGmail uses encodeURIComponent on the whole body, so we pass raw string here.

    return `您好，LUTU鋁圖已收到您的訂單。

訂單明細如下：
${formattedDetails}

目前為您報價總金額為： ${formatPrice(total)} ${feeStr}

匯款資訊如下：
銀行代碼：xxx
帳號：xxx`;
};

window.confirmQuotePrice = function (orderId, nextStatus) {
    const input = document.getElementById('quote-shipping-input');
    let val = parseInt(input.value);
    if (isNaN(val)) val = 0;

    if (val === 0) {
        if (!confirm("運費為 0，確定是免運嗎？")) return;
    }

    let target = ordersData.find(o => String(o.timestamp) === String(orderId));
    if (target) {
        let currentTotal = parseInt(String(target.total).replace(/[^0-9]/g, '') || 0);
        let newTotal = currentTotal + val;

        target.total = newTotal;
        target.status = nextStatus;
        applyFilter();
        window.lastActiveOrderId = orderId;

        // [New] Call Backend to Update Spreadsheet
        fetch(ADMIN_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updateOrderPrice',
                orderId: orderId, // Timestamp as ID
                newTotal: newTotal,
                shippingFee: val, // [New] Send shipping fee for stats
                status: nextStatus // [New] Persist Status to Column J
            })
        }).then(() => console.log('Price update sent to backend'))
            .catch(e => console.error('Failed to update backend price', e));

        // [New] Auto-open Gmail after quoting
        // [New] Auto-open Gmail after quoting
        if (target.email) {
            let mailSubject = encodeURIComponent(`LUTU訂購報價回覆 - ${target.name}`);
            let rawBody = window.generateMailBody(target.name, newTotal, val, target.details);
            let mailBody = encodeURIComponent(rawBody);
            window.openGmail(target.email, mailSubject, mailBody);
        }
    }
    closeModal();
};

// --- GLOBAL FUNCTIONS DEFINED FIRST ---
window.closeModal = function () {
    const m = document.getElementById('modal');
    if (m) m.style.display = 'none';
};

window.finishCheck = function () {
    if (!window.currentOrderForPrint) {
        closeModal();
        return;
    }

    const order = window.currentOrderForPrint;
    const currentStatus = order.status;

    // 確認所有項目都已勾選
    const allCards = document.querySelectorAll('.detail-card');
    const checkedCards = document.querySelectorAll('.detail-card.checked');

    if (allCards.length !== checkedCards.length) {
        alert('尚有項目未核對完成！');
        return;
    }

    // 根據當前狀態自動前進到下一階段
    if (['inspection', 'picking', 'packing'].includes(currentStatus)) {
        closeModal();
        advanceStatus(order.timestamp, currentStatus);
    } else {
        closeModal();
    }
};

// --- GLOBAL VARS ---
let ordersData = [];
let filteredOrders = [];
let currentFilter = 'all';

// --- CONFIGURATION ---
const STATUS_LABELS = {
    unquoted: "待報價",
    quoted: "已報價",
    paid: "已付款",
    cutting: "切料單",
    inspection: "對料/品檢",
    picking: "撿貨單",
    packing: "包裝",
    shipping: "待出貨/待取件",
    dispatched: "已出貨/已取件",
    completed: "已完成" // 新增完成狀態
};

const STANDARD_FLOW = ['unquoted', 'quoted', 'paid', 'shipping', 'dispatched', 'completed'];
const WORK_FLOW = ['cutting', 'inspection', 'picking', 'packing'];

// --- Inject Custom Styles for Checklist & Mobile Layout Rewrite ---
const customStyles = `
<style>



    /* Print/Checklist Styles (Preserved) */
    .modal-overlay { align-items: center; padding: 5px; z-index: 9999; } 
    .modal-content { max-height: 95vh; display: flex; flex-direction: column; width: 100%; max-width: 600px; }
    .modal-body { overflow-y: auto; flex: 1; padding: 10px; }

    .detail-card {
        cursor: pointer; display: flex !important; align-items: center; transition: all 0.2s ease;
        user-select: none; background: #fff; padding: 10px; border: 1px solid #eee;
        border-radius: 8px; margin-bottom: 8px;
    }
    .check-box {
        width: 24px; height: 24px; border: 2px solid #ddd; border-radius: 4px; margin-right: 12px;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        transition: all 0.2s; background: #fff;
    }
    
    /* 系列顏色 - 勾選後的背景色 */
    .detail-card.checked { opacity: 0.7; }
    .detail-card.checked .check-box i { display: block !important; color: #fff; font-size: 14px; }
    
    /* 20系列 - 藍色 */
    .detail-card.series-20.checked { background: #eff6ff; border-color: #93c5fd; }
    .detail-card.series-20.checked .check-box { background: #2980b9; border-color: #2980b9; }
    
    /* 30系列 - 橙色 */
    .detail-card.series-30.checked { background: #fff7ed; border-color: #fdba74; }
    .detail-card.series-30.checked .check-box { background: #d35400; border-color: #d35400; }
    
    /* 40系列 - 綠色 */
    .detail-card.series-40.checked { background: #f0fdf4; border-color: #86efac; }
    .detail-card.series-40.checked .check-box { background: #27ae60; border-color: #27ae60; }
    
    /* 其他/未分類 - 預設灰色 */
    .detail-card.checked:not([class*="series-"]) { background: #f8f9fa; border-color: #d1d5db; }
    .detail-card.checked:not([class*="series-"]) .check-box { background: #6b7280; border-color: #6b7280; }
    
    .detail-card .d-name { flex: 1; line-height: 1.4; font-size: 0.95rem; }

    .checklist-progress-bar {
        position: sticky; top: 0; background: #fff; z-index: 10; padding: 10px;
        margin: -10px -10px 10px -10px; border-bottom: 1px solid #eee;
        display: flex; justify-content: space-between; align-items: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .progress-pill.complete { background: #27ae60; color: #fff; }
    
    .btn-finish-check {
        width: 100%; padding: 12px; background: #ccc; color: #fff; border: none;
        border-radius: 6px; font-size: 1.1em; margin-top: 10px; cursor: pointer;
    }
    .btn-finish-check.active { background: #27ae60; cursor: pointer; }

    .btn-print {
        background: #3498db; color: white; border: none; padding: 6px 12px;
        border-radius: 4px; cursor: pointer; font-size: 0.9em; display: flex; align-items: center; gap: 5px;
    }
    .btn-print:hover { background: #2980b9; }

    .btn-close-inline {
        background: #eee; color: #555; border: none; padding: 6px 12px;
        border-radius: 4px; cursor: pointer; font-size: 0.9em;
    }

    /* Email Reply Button - Customer Service Orange - FORCE OVERRIDE */
    .kanban-card .btn-gmail, a.btn-gmail {
        background: #F39C12 !important; /* CS Orange */
        color: white !important;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9em;
        display: flex;
        align-items: center;
        gap: 5px;
        text-decoration: none;
        box-shadow: none;
    }
    .kanban-card .btn-gmail:hover, a.btn-gmail:hover { background: #E67E22 !important; }
    
    /* Column Header Colors for Work Flow */
    /* Factory Flow (Blue) */
    .status-cutting { background: #5DADE2; color: #fff; border: none; } /* Solid Blue */

    /* Warehouse & Logistics Flow (Continuous 5-Step Green Gradient) */
    .status-inspection { background: #A9DFBF; color: #fff; border: none; } /* Step 1: Very Light Green */
    .status-picking { background: #82E0AA; color: #fff; border: none; }    /* Step 2: Light Green */
    .status-packing { background: #52BE80; color: #fff; border: none; }    /* Step 3: Medium Green */
    .status-shipping { background: #27AE60; color: #fff; border: none; }   /* Step 4: Dark Green */
    .status-dispatched { background: #196F3D; color: #fff; border: none; } /* Step 5: Very Dark Green */

    /* Customer Service Flow (Orange Gradient) */
    .status-unquoted { background: #FFB74D; color: #fff; border: none; } /* Light Orange */
    .status-quoted { background: #F39C12; color: #fff; border: none; }   /* Medium Orange */
    .status-paid { background: #E67E22; color: #fff; border: none; }     /* Dark Orange */

    /* --- Kanban Grouping Styles --- */
    .kanban-board {
        /* Override default grid/flex to allow groups */
        display: flex;
        gap: 20px;
        align-items: stretch; /* Stretch groups to full height */
        overflow-x: auto;
        padding-bottom: 20px; /* Buffer for scrollbar */
        min-height: 60vh;
    }
    
    .kanban-group {
        /* No border/background as requested */
        display: flex;
        flex-direction: column;
        padding: 0 5px; /* Minimal padding */
        /* min-width removed to let columns dictate width */
        flex-shrink: 0;   /* Prevent shrinking */
    }

    .kanban-column {
        min-width: 300px; /* Ensure columns are wide enough */
        flex-shrink: 0;
    }
    
    .group-header {
        font-size: 1.1em;
        font-weight: bold;
        color: #fff; /* White text for colored headers */
        text-align: left; /* Aligned left for flex */
        padding: 10px 15px;
        border-radius: 6px;
        margin-bottom: 15px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        display: flex;
        justify-content: space-between; /* Title left, Tag right */
        align-items: center;
    }

    .header-tag {
        background: rgba(255,255,255,0.9);
        color: #333;
        font-size: 0.8rem;
        padding: 4px 10px;
        border-radius: 20px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        font-weight: normal;
        white-space: nowrap;
        margin-left: 10px;
    }

    /* Consolidated Cutting Button - Red with White Text */
    .btn-merge-cut {
        background: #e74c3c !important;
        color: white !important;
        border: none;
        padding: 6px 14px;
        border-radius: 20px;
        font-size: 0.9em;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        margin-left: 10px;
        white-space: nowrap;
        transition: transform 0.2s;
    }
    .btn-merge-cut:hover { transform: scale(1.05); background: #c0392b !important; }
    
</style>
`;
document.head.insertAdjacentHTML("beforeend", customStyles);


document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('admin_logged_in') === 'true') {
        showDashboard();
    }
    // Setup Modal Click Outside Close
    const m = document.getElementById('modal');
    if (m) {
        m.addEventListener('click', function (e) {
            if (e.target === this) closeModal();
        });
    }

    // Mobile Accordion: Toggle column visibility on header click
    setupMobileAccordion();
});

// Setup mobile accordion functionality
function setupMobileAccordion() {
    // Only activate on mobile (max-width: 768px)
    if (window.innerWidth > 768) return;

    // Add click listeners to all column headers
    document.addEventListener('click', function (e) {
        const header = e.target.closest('.column-header');
        if (!header || window.innerWidth > 768) return;

        const column = header.closest('.kanban-column');
        if (!column) return;

        const body = column.querySelector('.column-body');
        if (!body) return;

        // Toggle collapsed state
        header.classList.toggle('collapsed');
        body.classList.toggle('collapsed');
    });

    // Initialize all columns as collapsed on mobile
    if (window.innerWidth <= 768) {
        setTimeout(() => {
            document.querySelectorAll('.column-header').forEach(header => {
                header.classList.add('collapsed');
            });
            document.querySelectorAll('.column-body').forEach(body => {
                body.classList.add('collapsed');
            });
        }, 100);
    }
}

// Re-setup accordion when window is resized
window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        setupMobileAccordion();
    } else {
        // Remove collapsed states on desktop
        document.querySelectorAll('.column-header').forEach(header => {
            header.classList.remove('collapsed');
        });
        document.querySelectorAll('.column-body').forEach(body => {
            body.classList.remove('collapsed');
        });
    }
});

function showDashboard() {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    fetchOrders();
    // Pre-fetch inventory data for SKU lookups
    setTimeout(() => { if (window.fetchInventoryData) window.fetchInventoryData(); }, 500);
}

function checkLogin() {
    const input = document.getElementById('admin-pass').value;
    if (input === ADMIN_PASS) {
        sessionStorage.setItem('admin_logged_in', 'true');
        showDashboard();
    } else {
        document.getElementById('login-msg').innerText = "密碼錯誤";
        document.getElementById('login-msg').style.color = "red";
    }
}

window.showAllOrders = function (btnEl) {
    setActiveNav(btnEl);
    window.currentPrimaryView = 'all';
    window.currentDeliveryFilter = 'all';

    const board = document.querySelector('.kanban-board');
    if (board) board.classList.remove('hidden');
    document.getElementById('inventory-section').classList.add('hidden');

    // Show sidebar sub-filters
    const sidebarFilters = document.getElementById('sidebar-filters');
    if (sidebarFilters) sidebarFilters.style.display = 'flex';

    document.getElementById('page-title').innerText = "全部訂單管理";

    // Reset sub-filter buttons
    document.querySelectorAll('.sub-nav-btn').forEach(p => p.classList.remove('active'));
    const allBtn = document.querySelector('.sub-nav-btn[onclick*="all"]');
    if (allBtn) allBtn.classList.add('active');

    applyFilter();
};

window.showWorkOrders = function (btnEl) {
    setActiveNav(btnEl);
    window.currentPrimaryView = 'work';

    const board = document.querySelector('.kanban-board');
    if (board) board.classList.remove('hidden');
    document.getElementById('inventory-section').classList.add('hidden');

    // Hide sidebar sub-filters
    const sidebarFilters = document.getElementById('sidebar-filters');
    if (sidebarFilters) sidebarFilters.style.display = 'none';

    document.getElementById('page-title').innerText = "今日生產工單";

    applyFilter();
};

window.showWarehouseShipment = function (btnEl) {
    setActiveNav(btnEl);
    window.currentPrimaryView = 'shipment';

    const board = document.querySelector('.kanban-board');
    if (board) board.classList.remove('hidden');
    document.getElementById('inventory-section').classList.add('hidden');

    // Hide sidebar sub-filters
    const sidebarFilters = document.getElementById('sidebar-filters');
    if (sidebarFilters) sidebarFilters.style.display = 'none';

    document.getElementById('page-title').innerText = "今日出貨";

    applyFilter();
};

window.showInventory = function (btnEl) {
    setActiveNav(btnEl);
    window.currentPrimaryView = 'inventory';

    const board = document.querySelector('.kanban-board');
    if (board) board.classList.add('hidden');
    const invSection = document.getElementById('inventory-section');
    if (invSection) invSection.classList.remove('hidden');

    // Hide sidebar sub-filters
    const sidebarFilters = document.getElementById('sidebar-filters');
    if (sidebarFilters) sidebarFilters.style.display = 'none';

    document.getElementById('page-title').innerText = "成品/配件 庫存管理";

    // Always show Hub when first entering
    backToInventoryHub();

    if (!window.allInventory) {
        fetchInventoryData();
    }
};

window.filterByDelivery = function (type, btnEl) {
    document.querySelectorAll('.sub-nav-btn').forEach(p => p.classList.remove('active'));
    btnEl.classList.add('active');
    window.currentDeliveryFilter = type;
    applyFilter();
};

function setActiveNav(btnEl) {
    if (!btnEl) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
}

window.currentPrimaryView = 'all';
window.currentDeliveryFilter = 'all';

// Replace original filterOrders with an empty or redirecting function if needed, 
// but we'll mostly use showAllOrders/showWorkOrders now.
window.filterOrders = function (type, btn) {
    // Legacy support or direct call - redirect to showAllOrders if needed
    showAllOrders(btn);
};

function logout() {
    sessionStorage.removeItem('admin_logged_in');
    location.reload();
}

async function fetchOrders() {
    // Also fetch inventory if it's the current view? 
    // Usually keep separate to reduce load but fetchOrders is central.
    if (document.getElementById('inventory-section') && !document.getElementById('inventory-section').classList.contains('hidden')) {
        fetchInventoryData();
    }
    // ... rest of fetchOrders ...
    try {
        const res = await fetch(ADMIN_API_URL + "?action=getOrders&t=" + new Date().getTime());
        const json = await res.json();

        if (json.orders) {
            // Load saved statuses
            const savedStatuses = JSON.parse(localStorage.getItem('order_statuses') || '{}');

            ordersData = json.orders.map(order => {
                // Backend now handles defaults via Column J.
                // Priority: LocalStorage > API (Column J) > Fallback 'unquoted'

                let key = String(order.timestamp);
                if (savedStatuses[key]) {
                    order.status = savedStatuses[key];
                } else if (!order.status) {
                    order.status = 'unquoted';
                }
                return order;
            });

            applyFilter();
            document.getElementById('last-update').innerText = "最後更新: " + new Date().toLocaleTimeString();
        } else {
            ordersData = [];
            applyFilter();
        }
    } catch (e) {
        console.error(e);
    }
}

function applyFilter() {
    // Primary Filter: View Type
    let filtered = ordersData;

    if (window.currentPrimaryView === 'work') {
        // Today's Work Orders: Production phases only
        const workStatuses = ['paid', 'cutting', 'inspection', 'picking', 'packing'];
        filtered = ordersData.filter(o => workStatuses.includes(o.status));
    } else if (window.currentPrimaryView === 'shipment') {
        const shipmentStatuses = ['shipping', 'dispatched'];
        filtered = ordersData.filter(o => shipmentStatuses.includes(o.status));
    } else if (window.currentPrimaryView === 'inventory') {
        // Don't render Kanban if we are in inventory mode
        return;
    } else {
        // All Orders View with delivery sub-filter
        if (window.currentDeliveryFilter !== 'all') {
            filtered = ordersData.filter(o => (o.address || "").includes(window.currentDeliveryFilter));
        }
    }

    renderKanban(filtered);

    // Auto-Scroll Logic
    if (window.lastActiveOrderId) {
        setTimeout(() => {
            const card = document.querySelector(`.kanban - card[data - id="${window.lastActiveOrderId}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                // Add highlight effect?
                card.style.transition = "box-shadow 0.5s";
                card.style.boxShadow = "0 0 15px rgba(255, 193, 7, 0.8)";
                setTimeout(() => { card.style.boxShadow = ""; }, 2000);
            }
            window.lastActiveOrderId = null;
        }, 300); // Slight delay for rendering
    }
}

function renderKanban(data) {
    const board = document.querySelector('.kanban-board');
    if (!board) return;

    // Determine Groups based on view
    let groups = [];
    if (window.currentPrimaryView === 'work') {
        groups = [
            {
                title: "廠務權責區 <span class='header-tag'>13:00對單切料</span>",
                cols: ['cutting'],
                headerStyle: "background: #3498db;",
                actionBtn: `<button onclick="generateConsolidatedCuttingList()" class="btn-merge-cut">合併切料</button>`
            },
            {
                title: "倉儲包裝區 <span class='header-tag'>13:00-17:00對料 品檢 包裝</span>",
                cols: ['inspection', 'picking', 'packing'],
                headerStyle: "background: #27ae60;"
            }
        ];
    } else if (window.currentPrimaryView === 'shipment') {
        groups = [
            {
                title: "倉儲出貨區 <span class='header-tag'>8:00-12:00 出昨日訂單</span>",
                cols: ['shipping', 'dispatched'],
                headerStyle: "background: #16a085;"
            },
            {
                title: "完成訂單 📦 <span class='header-tag'>已完成的訂單存檔</span>",
                cols: ['completed'],
                headerStyle: "background: #95a5a6;"
            }
        ];
    } else {
        groups = [
            {
                title: "客服權責區 <span class='header-tag'>8:00-17:00 每日12:00收單</span>",
                cols: ['unquoted', 'quoted', 'paid'],
                headerStyle: "background: #e67e22;"
            },
            {
                title: "廠務權責區 <span class='header-tag'>13:00對單切料</span>",
                cols: ['cutting'],
                headerStyle: "background: #3498db;",
                actionBtn: `<button onclick="generateConsolidatedCuttingList()" class="btn-merge-cut" style="font-size:0.8rem; padding:4px 8px;">合併切料</button>`
            },
            {
                title: "倉儲包裝區 <span class='header-tag'>13:00-17:00對料 品檢 包裝</span>",
                cols: ['inspection', 'picking', 'packing'],
                headerStyle: "background: #27ae60;"
            },
            {
                title: "倉儲出貨區 <span class='header-tag'>8:00-12:00 出昨日訂單</span>",
                cols: ['shipping', 'dispatched'],
                headerStyle: "background: #16a085;"
            },
            {
                title: "完成訂單 📦 <span class='header-tag'>已完成的訂單存檔</span>",
                cols: ['completed'],
                headerStyle: "background: #95a5a6;"
            }
        ];
    }

    // Helper to generate Column HTML
    const getColHtml = (statusKey) => {
        let label = STATUS_LABELS[statusKey] || statusKey;
        // Label now includes both modes: 待出貨/待取件

        return `
    <div class="kanban-column">
                <div class="column-header status-${statusKey}">
                    <span>${label}</span>
                    <span class="count-badge" id="count-${statusKey}">0</span>
                </div>
                <div class="column-body" id="col-${statusKey}"></div>
            </div>`;
    };

    // Render HTML Structure
    let html = `
    <div class="kanban-columns-container">
        `;

    groups.forEach(g => {
        let colsHtml = g.cols.map(c => getColHtml(c)).join('');
        let actionHtml = g.actionBtn ? g.actionBtn : '';
        html += `
        <div class="kanban-group">
            <div class="group-header" style="${g.headerStyle}">
                <div style="display:flex; align-items:center;">
                    ${g.title}
                </div>
                ${actionHtml}
            </div>
            <div class="group-columns">
                ${colsHtml}
            </div>
        </div>`;
    });

    html += `</div>`;
    board.innerHTML = html;

    // Distribute Cards & Update Counts
    let counts = {};
    data.forEach(order => {
        const status = order.status || 'unquoted';
        const body = document.getElementById(`col-${status}`);
        if (body) {
            counts[status] = (counts[status] || 0) + 1;
            body.appendChild(createCard(order, counts[status], status));
        }
    });

    // Update badges
    for (let s in counts) {
        const badge = document.getElementById(`count-${s}`);
        if (badge) badge.innerText = counts[s];
    }
}

// --- New Function: Generate Consolidated Cutting List ---
// Enhanced with Cutting Optimization & Visualization

// --- Cutting Algorithm Logic (ThinkingCutter) ---


// === Rounding Helper ===
function roundToHalf(num) {
    return Math.floor(num * 2) / 2; // Floor to avoid over-estimating stock
}

class ThinkingCutter {
    constructor(stockLength = 600, kerf = 0.5, minWaste = 10) {
        this.stockLength = stockLength;
        this.kerf = kerf;
        this.minWaste = minWaste;
        this.offcuts = []; // Available offcuts: { id, length }
    }

    setOffcuts(offcutsList) {
        // offcutsList: Array of lengths [150, 45, ...]
        this.offcuts = offcutsList.map((len, idx) => ({
            id: `off - ${idx} `,
            length: len,
            originalLength: len,
            cuts: [],
            isNewStock: false
        }));
    }

    solve(requirements) {
        // requirements: [{ name, length, qty, color, orderName }, ...]
        // 1. Expand requirements into individual cuts
        let pieces = [];
        requirements.forEach(req => {
            for (let i = 0; i < req.qty; i++) {
                pieces.push({
                    length: req.length,
                    name: req.name,
                    color: req.color,
                    series: req.series, // Pass series information
                    orderName: req.orderName
                });
            }
        });

        // 2. Sort pieces Descending (Best Fit Decreasing)
        pieces.sort((a, b) => b.length - a.length);

        // 3. Prepare Bins (Available Offcuts)
        // We will add new stock bins dynamically
        // 3. Prepare Bins (Available Offcuts)
        // Correctly map offcuts directly to bin objects
        // 3. Prepare Bins (Available Offcuts)
        // Clone offcut objects from this.offcuts (which are already objects)
        let bins = this.offcuts.map(off => ({
            id: off.id,
            length: off.length,
            originalLength: off.originalLength,
            cuts: [],
            isNewStock: false
        }));

        // 4. Allocate
        pieces.forEach(piece => {
            let bestBinIndex = -1;
            let minRemainder = Infinity;

            // Try to find best fitting bin
            for (let i = 0; i < bins.length; i++) {
                let bin = bins[i];
                let currentUsed = bin.cuts.reduce((sum, c) => sum + c.length + this.kerf, 0);
                // Check if fits (Note: Last cut technically doesn't need kerf at the very end, 
                // but usually we cut FROM the bar, so every cut removes material + kerf width.
                // Simpler model: (Used + NewItem + Kerf) <= Total)

                // Correction: The gap is occupied by the saw blade. 
                // If we cut 100cm, we use 100cm of material effectively, 
                // but we loose 0.5cm of the *remaining* stock.
                // So: Remaining = Original - (Cut + Kerf)

                let remaining = bin.length; // Length available to be cut
                // Note: bin.length in this logic will track "Current Remaining Length" to simplify?
                // No, better to calculate from original

                // Check if fits
                // Normal case: Need Piece + Kerf
                if (bin.length >= (piece.length + this.kerf)) {
                    let rem = bin.length - (piece.length + this.kerf);
                    if (rem < minRemainder) {
                        minRemainder = rem;
                        bestBinIndex = i;
                    }
                }
                // Exact fit case: If bin is roughly equal to piece (within 0.1), allow it
                // We assume we use the whole offcut without needing an extra cut width at the end
                else if (Math.abs(bin.length - piece.length) < 0.2) {
                    let rem = 0;
                    if (rem < minRemainder) {
                        minRemainder = rem;
                        bestBinIndex = i;
                    }
                }
            }

            if (bestBinIndex !== -1) {
                // Determine Bin
                let bin = bins[bestBinIndex];
                bin.cuts.push(piece);

                // Update remaining length
                // If it was an exact fit (or close), consume all
                if ((bin.length - piece.length) < this.kerf) {
                    bin.length = 0;
                } else {
                    bin.length = roundToHalf(bin.length - (piece.length + this.kerf)); // Consumed
                }
            } else {
                // Create New Stock Bin
                let newBin = {
                    id: `new- ${bins.length} `,
                    length: this.stockLength,
                    originalLength: this.stockLength,
                    cuts: [piece],
                    isNewStock: true
                };
                newBin.length = roundToHalf(this.stockLength - (piece.length + this.kerf));
                bins.push(newBin);
            }
        });

        return bins.filter(b => b.cuts.length > 0 || !b.isNewStock); // Return used bins or original offcuts provided
    }
}

// Global Cutter State
let currentCutter = new ThinkingCutter();
let lastComputedPlan = null;

async function generateConsolidatedCuttingList() {
    // 0. Auto-Fetch Inventory if missing (for auto-import offcuts)
    if (!window.allInventory) {
        try {
            // Force fetch
            const res = await fetch(ADMIN_API_URL + "?action=getInventory&t=" + new Date().getTime());
            const json = await res.json();
            if (json.inventory) window.allInventory = json.inventory;
            else if (json.data) window.allInventory = json.data;
            else if (Array.isArray(json)) window.allInventory = json;
        } catch (e) {
            console.error("Auto-fetch inventory failed", e);
        }
    }

    // 1. Filter Orders (Status: cutting)
    let cuttingOrders = ordersData.filter(o => o.status === 'cutting');

    if (cuttingOrders.length === 0) {
        alert("目前沒有「切料單」狀態的訂單！");
        return;
    }

    // 2. Parse and Aggregate Items
    let aggregated = {}; // Key: "Series-Name-Length", Value: {qty, name, length, series, refs}

    cuttingOrders.forEach(order => {
        if (!order.details) return;
        let lines = order.details.split(/\\n|\n/).filter(l => l.trim().length > 0);

        lines.forEach(line => {
            // Check if profile (Skip accessories generally, per user request usually Cutting List implies Profiles, but let's include profiles mainly)
            // Use same logic as renderDetailCards to identify Series and Length
            let isProfile = (line.includes('【銘材】') || line.includes('銘材') || line.includes('鋁擠型') || line.includes('鋁材'));
            let series = 99;
            let foundKey = Object.keys(PRODUCT_MAP).find(key => line.includes(key));
            if (foundKey) {
                if (foundKey.includes('鋁擠型')) isProfile = true;
                series = parseInt(PRODUCT_MAP[foundKey]);
            }

            // Fallback Series Detection
            if (series === 99) {
                // More precise detection to avoid matching "L=200" as "20 series"
                // Remove header like 【鋁材】
                let tempName = line.replace(/^【.*?】\s*/, '').trim();

                if (tempName.startsWith('20')) series = 20;
                else if (tempName.startsWith('30')) series = 30;
                else if (tempName.startsWith('40') || tempName.startsWith('80')) series = 40;

                // Safety next: specific keywords
                else if (line.includes('20型') || line.includes('20系列')) series = 20;
                else if (line.includes('30型') || line.includes('30系列')) series = 30;
                else if (line.includes('40型') || line.includes('40系列')) series = 40;
            }

            // Only aggregate profiles for cutting list
            if (!isProfile) return;

            // Extract Length
            let length = 0;
            let lenMatch = line.match(/\(L=([0-9]+)cm\)/);
            if (lenMatch) length = parseInt(lenMatch[1]);

            // If no length (e.g. fixed length or not specified), maybe not a cut item or standard
            // We focus on items with Length specified
            if (length === 0) return;

            // Extract Qty
            let qty = 1;
            let qtyMatch = line.match(/\( x ([0-9]+) \)/);
            if (qtyMatch) qty = parseInt(qtyMatch[1]);

            // Clean Name (Remove Qty and Length for grouping key)
            let baseName = line.replace(/ -- \$[0-9]+/, '')
                .replace(/\( x [0-9]+ \)/, '')
                .replace(/\(L=[0-9]+cm\)/, '')
                .trim();

            let key = `${series} -${baseName} -${length} `;

            if (!aggregated[key]) {
                aggregated[key] = {
                    series: series,
                    name: baseName,
                    length: length,
                    qty: 0,
                    orders: []
                };
            }
            aggregated[key].qty += qty;
            if (!aggregated[key].orders.includes(order.name)) {
                aggregated[key].orders.push(order.name);
            }
        });
    });

    // 3. Convert to Array and Sort
    let list = Object.values(aggregated);
    list.sort((a, b) => {
        if (a.series !== b.series) return a.series - b.series; // Group by Series
        if (a.name !== b.name) return a.name.localeCompare(b.name);
        return b.length - a.length; // Longest first for cutting efficiency
    });

    // 4. Render Layout (Reusing Modal)
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');

    // UI Structure: Tabs for [List View] and [Cutting View]
    const renderTable = () => {
        let tableRows = list.map(item => {
            let seriesColor = '#3498db';
            if (item.series === 30) seriesColor = '#e67e22';
            if (item.series === 40) seriesColor = '#27ae60';

            return `
    <tr style="border-bottom:1px solid #ddd;">
                    <td style="padding:8px; font-weight:bold; color:${seriesColor};">${item.series}系列</td>
                    <td style="padding:8px;">${item.name}</td>
                    <td style="padding:8px; font-weight:bold; color:#c0392b;">${item.length} cm</td>
                    <td style="padding:8px; font-weight:bold; font-size:1.1em;">${item.qty} 支</td>
                    <td style="padding:8px; font-size:0.8em; color:#7f8c8d;">${item.orders.join(', ')}</td>
                </tr>
    `;
        }).join('');

        return `
    <div style="margin-bottom:15px; background:#fff3cd; padding:10px; border-radius:4px; color:#856404; font-size:0.9em;">
        <i class="fas fa-info-circle"></i> 僅包含狀態為「切料單」的訂單中，標註為【銘材 / 鋁擠型】且指定長度(L = xx)的項目。
            </div>
    <table style="width:100%; border-collapse:collapse; background:#fff;">
        <thead>
            <tr style="background:#f2f2f2; text-align:left;">
                <th style="padding:10px;">系列</th>
                <th style="padding:10px;">品名</th>
                <th style="padding:10px;">長度</th>
                <th style="padding:10px;">總數量</th>
                <th style="padding:10px;">來源訂單</th>
            </tr>
        </thead>
        <tbody>${tableRows}</tbody>
    </table>
`;
    };

    // Store data globally for the optimization function to access
    window.currentCuttingData = list;

    body.innerHTML = `
    <div style="padding:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:2px solid #333; padding-bottom:10px;">
                <div>
                    <h2 style="margin:0; color:#333;">合併切料工單</h2>
                    <span style="font-size:0.9em; color:#666;">產生時間: ${new Date().toLocaleString()}</span>
                </div>
                <div style="display:flex; gap:10px;">
                    <button onclick="switchCutTab('list')" class="nav-btn-tab active" id="tab-btn-list">清單總表</button>
                    <button onclick="switchCutTab('opt')" class="nav-btn-tab" id="tab-btn-opt">切割運算</button>
                </div>
            </div>
            
            <div id="cut-content-list" style="display:block;">
                ${renderTable()}
            </div>

            <div id="cut-content-opt" style="display:none;">
                <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:20px; border:1px solid #eee;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">1. 設定各型號參數</h3>
                        <div style="background:#fff; padding:5px 10px; border-radius:4px; border:1px solid #ddd; font-size:0.85rem;">
                            全域鋸路損耗: <input type="number" id="opt-kerf" value="0.5" step="0.1" style="width:50px; border:none; border-bottom:1px solid #999; text-align:center;"> cm
                        </div>
                    </div>
                    
                    <div id="opt-params-container" style="display:flex; flex-direction:column; gap:10px;">
                        <!-- Dynamic Model Rows go here -->
                    </div>

                    <div style="margin-top:20px; text-align:center; border-top:1px solid #eee; padding-top:15px;">
                        <button onclick="runCuttingOptimization()" style="background:#27ae60; color:white; border:none; padding:12px 40px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:1.1rem; box-shadow:0 4px 6px rgba(39,174,96,0.2);">
                            <i class="fas fa-calculator"></i> 開始計算切割計畫
                        </button>
                    </div>
                </div>
                
                <div id="opt-req-summary" style="margin-bottom:20px; border:1px solid #ddd; border-radius:8px; padding:12px; background:#fff;">
                    <h4 style="margin-top:0; color:#666; font-size:0.9rem;">待計算項目摘要：</h4>
                    <div id="opt-req-list" style="font-size:0.85rem; color:#444;"></div>
                </div>

                <div id="opt-results-area">
                    <div style="text-align:center; color:#999; padding:40px;">
                        請輸入參數並點擊「開始計算」以產生切割圖
                    </div>
                </div>
            </div>

            <div style="margin-top:20px; text-align:right;">
                 <button onclick="window.printCuttingList()" class="btn-print" style="display:inline-flex; background:#e74c3c; padding:10px 20px; font-size:1em;">
                    <i class="fas fa-print"></i> 列印工單
                </button>
                <button onclick="window.closeModal()" style="padding:10px 20px; background:#ccc; border:none; border-radius:6px; cursor:pointer; margin-left:10px;">
                    關閉
                </button>
            </div>
        </div >
    `;

    modal.style.display = 'flex';
}

window.printCuttingList = function () {
    const listHtml = document.getElementById('cut-content-list').innerHTML;
    // Get only the results area from the optimization tab to avoid printing parameters/buttons
    const resultArea = document.getElementById('opt-results-area');
    const optResultsHtml = resultArea ? resultArea.innerHTML : "";

    // Check if optimization has been run (content isn't the placeholder)
    const isOptRun = optResultsHtml.indexOf('opt-results-area') === -1 && optResultsHtml.indexOf('請輸入參數') === -1;

    let printWindow = window.open('', '', 'width=1100,height=800');

    // Get existing styles
    let styles = '';
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(s => {
        styles += s.outerHTML;
    });

    printWindow.document.write(`
    < html >
        <head>
            <title>合併切料工單 - 完整內容</title>
            ${styles}
            <style>
                @page { size: A4 landscape; margin: 10mm; }
                body { padding: 20px; background: white !important; font-family: "Noto Sans TC", sans-serif; }
                .no-print, button, .opt-param-row, #opt-params-container, #opt-req-summary { display: none !important; }
                .print-section { margin-bottom: 40px; page-break-after: auto; }
                .section-title { 
                    border-bottom: 2px solid #333; 
                    padding-bottom: 5px; 
                    margin-bottom: 15px; 
                    margin-top: 30px;
                    font-size: 1.2rem;
                }
                /* Ensure colors print */
                * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            </style>
        </head>
        <body>
            <div style="margin-bottom:20px; border-bottom:3px solid #000; padding-bottom:10px; display:flex; justify-content:space-between; align-items:flex-end;">
                <div>
                    <h1 style="margin:0; font-size:1.8rem;">LUTU 鋁圖 - 合併切料工單</h1>
                    <div style="font-size:0.9em; color:#666;">產生時間: ${new Date().toLocaleString()}</div>
                </div>
            </div>

            <div class="print-section">
                <div class="section-title"><i class="fas fa-list"></i> 1. 待切清單總表</div>
                ${listHtml}
            </div>

            ${isOptRun ? `
            <div class="print-section" style="page-break-before: always;">
                <div class="section-title"><i class="fas fa-cut"></i> 2. 切割優化方案 (視覺化)</div>
                <div class="cutting-visuals">
                    ${optResultsHtml}
                </div>
            </div>
            ` : ''}

            <script>
                window.onload = function() {
                    setTimeout(() => {
                        window.print();
                        window.close();
                    }, 500);
                }
            </script>
        </body>
        </html >
    `);
    printWindow.document.close();
};

window.switchCutTab = function (tab) {
    document.getElementById('cut-content-list').style.display = tab === 'list' ? 'block' : 'none';
    document.getElementById('cut-content-opt').style.display = tab === 'opt' ? 'block' : 'none';
    document.getElementById('tab-btn-list').classList.toggle('active', tab === 'list');
    document.getElementById('tab-btn-opt').classList.toggle('active', tab === 'opt');

    if (tab === 'opt') {
        const list = window.currentCuttingData || [];
        const container = document.getElementById('opt-params-container');
        const reqSummaryList = document.getElementById('opt-req-list');

        // 1. Render Summary
        let summary = list.map(i => `${i.name} (${i.length}cm)x${i.qty} `).join(' | ');
        reqSummaryList.innerText = summary || "選單中無待切鋁材";

        // 2. Render Parameter Rows for each unique model
        let uniqueModels = [...new Set(list.map(i => i.name))].sort();

        container.innerHTML = uniqueModels.map(model => {
            const item = list.find(i => i.name === model);
            const series = item ? item.series : 99;
            let seriesColor = '#2c3e50';
            if (series === 20) seriesColor = '#3498db';
            if (series === 30) seriesColor = '#e67e22';
            if (series === 40) seriesColor = '#27ae60';

            const cleanModelName = model.replace(/^\u3010.*?\u3011\s*/, '').trim();
            let autoOffcuts = "";
            if (window.allInventory) {
                const invItem = window.allInventory.find(i => i.name.includes(cleanModelName));
                if (invItem && invItem.offcuts) {
                    // Smart Split Logic
                    let str = String(invItem.offcuts).trim();
                    let parsedArr = [];
                    let chunks = str.split(/[,，]/).filter(s => s.trim().length > 0);
                    chunks.forEach(s => {
                        let num = parseFloat(s);
                        if (num > 650) {
                            // Try to split logic
                            let s2 = s.trim();
                            while (s2.length > 0) {
                                let chunk = s2.substring(0, s2.indexOf('.') + 2);
                                if (!chunk || chunk.length < 3) chunk = s2.substring(0, 3);
                                let val = parseFloat(chunk);
                                if (!isNaN(val)) parsedArr.push(val);
                                s2 = s2.substring(chunk.length);
                                if (parsedArr.length > 20) break;
                            }
                        } else if (num > 0) {
                            parsedArr.push(num);
                        }
                    });
                    if (parsedArr.length > 0) autoOffcuts = parsedArr.join(', ');
                }
            }

            const savedLen = localStorage.getItem(`cut_stock_len_${model} `) || "600";
            // Priority: Inventory > LocalStorage > Empty
            const savedOff = autoOffcuts || localStorage.getItem(`cut_offcuts_${model}`) || "";

            return `
    <div class="opt-param-row" data-model="${cleanModelName}" style="display:grid; grid-template-columns: 1fr 120px 1fr; gap:15px; align-items:center; background:#fff; padding:10px; border-radius:6px; border:1px solid #eee;">
                    <div style="font-weight:bold; color:${seriesColor};">【${cleanModelName}】</div>
                    <div>
                        <input type="number" class="model-stock-len" data-model="${cleanModelName}" value="${savedLen}" placeholder="標準長" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                    </div>
                    <div>
                        <input type="text" class="model-offcuts" data-model="${cleanModelName}" value="${savedOff}" placeholder="餘料 (如: 150, 45)" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                    </div>
                </div>
    `;
        }).join('');

        if (uniqueModels.length === 0) {
            container.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">目前沒有需要切割的鋁材</div>';
        } else {
            // Add column headers
            container.insertAdjacentHTML('afterbegin', `
    <div style="display:grid; grid-template-columns: 1fr 120px 1fr; gap:15px; padding:0 10px; font-size:0.8rem; color:#888; font-weight:bold;">
                    <div>型號名稱</div>
                    <div>標準料長 (cm)</div>
                    <div>現有餘料 (cm)</div>
                </div>
    `);
        }
    }
};

window.runCuttingOptimization = function () {
    const kerf = parseFloat(document.getElementById('opt-kerf').value) || 0.5;

    // 1. Group items by Model Name for independent optimization
    let list = window.currentCuttingData || [];
    let groups = {};
    list.forEach(item => {
        // Clean model name: remove category prefixes like 【鋁材】, 【配件】
        let cleanName = item.name.replace(/^\u3010.*?\u3011\s*/, '').trim();

        if (!groups[cleanName]) groups[cleanName] = [];
        groups[cleanName].push({
            name: cleanName,
            length: item.length,
            qty: item.qty,
            series: item.series
        });
    });

    let html = '';
    const sortedGroups = Object.keys(groups).sort();

    for (let modelName of sortedGroups) {
        let modelReqs = groups[modelName];

        // 2. Get parameters for this specific model from the UI
        const stockInput = document.querySelector(`.model-stock-len[data-model="${modelName}"]`);
        const offcutsInput = document.querySelector(`.model-offcuts[data-model="${modelName}"]`);

        const stockLen = stockInput ? (parseInt(stockInput.value) || 600) : 600;
        const offcutsStr = offcutsInput ? (offcutsInput.value || "") : "";

        // 3. Persist to localStorage for user convenience
        localStorage.setItem(`cut_stock_len_${modelName}`, stockLen);
        localStorage.setItem(`cut_offcuts_${modelName}`, offcutsStr);

        // 4. Prepare offcuts array
        let offcuts = offcutsStr.split(/[,，]/).map(s => parseFloat(s.trim())).filter(n => n > 0);

        // 5. Run Optimization for this Model
        let modelCutter = new ThinkingCutter(stockLen, kerf, 10);
        modelCutter.setOffcuts(offcuts);

        let bins = modelCutter.solve(modelReqs);

        // 6. Render result header and visuals
        let sColor = '#3498db';
        const modelSeries = (modelReqs && modelReqs.length > 0) ? modelReqs[0].series : 99;
        if (modelSeries === 30) sColor = '#e67e22';
        if (modelSeries === 40) sColor = '#27ae60';

        html += `<h3 style="border-left:5px solid ${sColor}; padding-left:10px; margin-top:30px; color:${sColor};">【${modelName}】 切割計畫 <span style="font-size:0.75em; color:#888; font-weight:normal;">(原料:${stockLen} cm, 餘料:${offcuts.length}支)</span></h3>`;
        html += renderCuttingVisuals(bins, stockLen);
    }

    document.getElementById('opt-results-area').innerHTML = (html || '<div style="padding:40px; text-align:center; color:#999;">目前沒有待切割項目。</div>');

    if (html) {
        document.getElementById('opt-results-area').insertAdjacentHTML('beforeend', `
    <button class="btn-record-offcut" onclick="recordCuttingPlanToInventory()">
        <i class="fas fa-save"></i> 確認切割計畫並更新庫存（扣料 + 記錄餘料 / 廢料）
            </button>
    `);
    }
};

function renderCuttingVisuals(bins, stockLen) {
    if (bins.length === 0) return "無需求";

    let html = `<div class="cutting-visuals">`;

    bins.forEach((bin, idx) => {
        let isOffcut = !bin.isNewStock;
        let originalLen = bin.originalLength;

        // Calculate used width perc
        let cutsHtml = '';
        let currentPos = 0;

        bin.cuts.forEach(cut => {
            let widthPerc = (cut.length / originalLen) * 100;
            let bgColor = '#3498db'; // Default blue (20)
            if (cut.series === 30) bgColor = '#e67e22'; // Orange
            if (cut.series === 40) bgColor = '#27ae60'; // Green

            cutsHtml += `
    <div class="cut-block" style="width:${widthPerc}%; background-color:${bgColor};" title="${cut.name} (${cut.length}cm)">
        <span class="cut-len">${cut.length}</span>
                </div>
    `;
            // Kerf visual?
            let kerfPerc = (0.5 / originalLen) * 100;
            cutsHtml += `
    <div class="cut-kerf" style="width:${kerfPerc}%;" title="鋸路 0.5cm"></div>
        `;
        });

        // Remainder
        let usedLen = bin.originalLength - bin.length; // bin.length is remaining
        let remainLen = bin.length;
        if (remainLen > 0) {
            let remainPerc = (remainLen / originalLen) * 100;
            let typeClass = remainLen < 10 ? 'waste' : 'leftover';
            let label = remainLen < 10 ? '廢' : '餘';
            cutsHtml += `
        <div class="cut-remain ${typeClass}" style="width:${remainPerc}%;" title="剩餘 ${remainLen.toFixed(1)}cm">
            <span class="remain-len">${label} ${remainLen.toFixed(1)}</span>
                </div>
    `;
        }

        let label = isOffcut ? `餘料 #${idx + 1}` : `新料 #${idx + 1}`;
        let bgStyle = isOffcut ? 'background:#fff3e0; border-color:#e67e22;' : 'background:#e8f8f5; border-color:#2ecc71;';

        html += `
    <div class="cut-row" style="${bgStyle}">
                <div class="cut-label">${label} <span style="font-size:0.8em; color:#666;">(${originalLen}cm)</span></div>
                <div class="cut-bar-container">
                    ${cutsHtml}
                </div>
            </div >
    `;
    });

    html += `</div > `;
    return html;
}

function formatPrice(val) {
    if (!val) return "NT$ 0";
    // Use parseInt to extract the first number, handling "77 (Included...)" correctly
    let num = parseInt(String(val), 10);
    return "NT$ " + (isNaN(num) ? "0" : num);
}

window.openGmail = function (email, subject, body) {
    console.log("嘗試開啟 Gmail 網頁版:", email);
    // 直接開啟 Gmail 網頁版撰寫視窗，確保是 "GMAIL"
    // 注意：subject 和 body 已經是 encoded 的，但在 URL 中可能需要再次確認，
    // 不過通常 mailto 和 query param 的編碼相容。
    // 為了安全起見，這裡假設傳入的已經是 encodeURIComponent 過的。
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}&su=${subject}&body=${body}`;
    window.open(url, '_blank');
};

function createCard(order, index, currentStatus) {
    const el = document.createElement('div');
    el.className = 'kanban-card';
    el.onclick = () => viewOrder(order);

    let time = order.timestamp;
    try {
        let d = new Date(order.timestamp);
        time = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes().toString().padStart(2, '0');
    } catch (e) { }

    let tag = "";
    let isSelfPickup = false;
    let isStore = false;

    if ((order.address || "").includes("宅配")) tag = "宅配";
    if ((order.address || "").includes("自取")) {
        tag = "自取";
        isSelfPickup = true;
    }
    if ((order.address || "").includes("店到店")) {
        tag = "店到店";
        isStore = true;
    }
    if ((order.address || "").includes("公司配送")) tag = "公司配送";

    // Determine Next Step Logic
    let nextStatus = null;
    let prevStatus = null;

    let flow = STANDARD_FLOW;
    if (WORK_FLOW.includes(currentStatus)) flow = WORK_FLOW;

    let currIdx = flow.indexOf(currentStatus);

    if (currIdx !== -1) {
        if (currIdx < flow.length - 1) nextStatus = flow[currIdx + 1];
        if (currIdx > 0) prevStatus = flow[currIdx - 1];
    }

    if (currentStatus === 'paid') {
        nextStatus = 'cutting';
    }

    if (currentStatus === 'packing') {
        nextStatus = 'shipping';
    }

    let nextBtnHtml = '';
    if (nextStatus) {
        let nextLabel = STATUS_LABELS[nextStatus];
        let btnText = nextLabel;

        if (currentStatus === 'unquoted' && nextStatus === 'quoted') {
            // Need quoting for Home Delivery and Company Delivery
            let needsQuote = !isSelfPickup && !isStore;
            btnText = needsQuote ? "輸入報價金額" : "已報價";
        }
        if (currentStatus === 'paid' && nextStatus === 'cutting') btnText = "開始工單流程";
        if (currentStatus === 'packing' && nextStatus === 'shipping') btnText = "完成包裝 (移至待出貨)";

        let btnClass = 'btn-to-' + nextStatus;

        // Define Target Colors for Buttons
        const STATUS_COLORS = {
            'quoted': '#F39C12',
            'paid': '#E67E22',
            'cutting': '#5DADE2',      // Factory Blue
            'inspection': '#A9DFBF',   // Green Step 1
            'picking': '#82E0AA',      // Green Step 2
            'packing': '#52BE80',      // Green Step 3
            'shipping': '#27AE60',     // Green Step 4
            'dispatched': '#196F3D'    // Green Step 5
        };

        let style = '';
        if (STATUS_COLORS[nextStatus]) {
            style = `background: ${STATUS_COLORS[nextStatus]}; color: #fff; border: none; `;
        }

        nextBtnHtml = `
        <button class="btn-card-action ${btnClass}" style="${style}" title="移至${nextLabel}"
    onclick="event.stopPropagation(); advanceStatus('${order.timestamp}', '${nextStatus}')">
        ${btnText} <i class="fas fa-chevron-right"></i>
            </button> `;
    }

    let prevBtnHtml = '';
    // [Fix] Block regression to 'unquoted', 'dispatched' AND 'completed' (Committed)
    if (prevStatus && prevStatus !== 'unquoted' && currentStatus !== 'dispatched' && currentStatus !== 'completed') {
        let prevLabel = STATUS_LABELS[prevStatus];
        prevBtnHtml = `
        <button class="btn-card-action btn-prev" title="退回${prevLabel}"
    onclick="event.stopPropagation(); regressStatus('${order.timestamp}', '${prevStatus}')">
        <i class="fas fa-chevron-left"></i>
            </button> `;
    }

    let mailSubject = encodeURIComponent(`LUTU訂購報價回覆 - ${order.name}`);
    let rawBody = window.generateMailBody(order.name, order.total, order.shippingFee || 0, order.details);
    let mailBody = encodeURIComponent(rawBody);

    el.innerHTML = `
    <div class="card-top">
        <span>#${index + 1}</span>
        <span>${time}</span>
    </div>
    <div class="card-title">${order.name}</div>
    <div class="card-info"><i class="fas fa-phone-alt"></i> ${order.phone}</div>
    <div class="card-info" style="font-size:0.85em; color:#666; margin-top:3px; word-break:break-all;">
        <i class="far fa-envelope"></i> ${order.email || "無 Email"}
    </div>
    ${tag ? `<span class="card-tag">${tag}</span>` : ''}
    <div class="card-price">
        ${formatPrice(order.total)}
        ${(currentStatus === 'unquoted' && !isSelfPickup && !isStore) ? '<span style="font-size:0.7em; color:#e67e22; margin-left:5px; font-weight:normal;">(待報價)</span>' : ''}
        ${(order.shippingFee && order.shippingFee > 0) ? `<div style="font-size:0.75rem; color:#888; font-weight:normal; margin-top:2px;">(含運費 $${order.shippingFee})</div>` : ''}
    </div>

    <div class="card-actions">
        ${prevBtnHtml}
            <button class="btn-card-action btn-gmail" 
            onclick="event.stopPropagation(); window.openGmail('${order.email}', '${mailSubject}', '${mailBody}')">
            <i class="fas fa-envelope"></i> 回覆
            </button>
            ${nextBtnHtml}
        </div>
    `;
    return el;
}

window.regressStatus = function (orderId, prevStatus) {
    let target = ordersData.find(o => o.timestamp === orderId);
    if (target) {
        // [Safety Guard] Prevent regression if accessories were deducted
        if (target.status === 'shipping' || target.status === 'dispatched') {
            if (localStorage.getItem(`deducted_acc_${orderId}`)) {
                alert("⚠️ 無法退回上一步！\n\n此訂單的配件庫存已經扣除。\n若強制退回將導致庫存重複扣除或數據不一致。\n若必須退回，請聯繫管理員手動調整庫存。");
                return;
            }
        }

        // [Safety Guard] Prevent regression to Cutting if Aluminum was deducted
        if ((prevStatus === 'cutting' || prevStatus === 'paid') && window.isProfileDeducted(target)) {
            alert("⚠️ 無法退回上一步！\n\n此訂單的鋁材已經切料扣帳。\n若強制退回將導致庫存重複扣除或數據不一致。\n若必須退回，請聯繫管理員手動調整庫存。");
            return;
        }

        // [Safety Guard] Confirm before reverting to Unquoted
        if (prevStatus === 'unquoted') {
            if (!confirm("⚠️ 確定要退回「未報價」嗎？\n\n這代表此訂單將回到初始狀態，可能需要重新報價。")) {
                return;
            }
        }

        target.status = prevStatus;

        // Save to LocalStorage
        let saved = JSON.parse(localStorage.getItem('order_statuses') || '{}');
        saved[orderId] = prevStatus;
        localStorage.setItem('order_statuses', JSON.stringify(saved));

        applyFilter();
    }
};

window.advanceStatus = function (orderId, nextStatus) {
    // Robust find (handle string/number timestamp mismatch)
    if (!ordersData || ordersData.length === 0) {
        alert("未找到訂單或載入失敗！請檢查控制台。");
        console.warn("ordersData is empty or undefined");
        return;
    }
    let target = ordersData.find(o => String(o.timestamp) === String(orderId));
    if (!target) {
        console.error("Order not found:", orderId);
        return;
    }

    // --- 1. Quoted Safety Check (Modal + Self-Pickup Skip) ---
    if (target.status === 'unquoted' && nextStatus === 'quoted') {
        const addr = (target.address || "").toLowerCase();
        // Smart Skip: Self-Pickup implies 0 shipping
        if (addr.includes("自取") || addr.includes("店到店")) {
            // Apply 0 shipping for Pickup, 60 for S2S
            let fee = addr.includes("店到店") ? 60 : 0;
            let currentTotal = parseInt(String(target.total).replace(/[^0-9]/g, '') || 0);

            // Only add fee if not already included (simple check)
            // Actually, for old orders, we should just assume we need to add it if it's S2S? 
            // Or maybe just re-calculate total. 
            // Let's assume currentTotal excludes fee if it was unquoted.
            let newTotal = currentTotal + fee;

            target.total = newTotal;
            target.shippingFee = fee;
            target.status = nextStatus;

            // [New] Auto-open Gmail for Self-Pickup/S2S (SOP) - Moved before fetch for better popup behavior
            if (target.email) {
                let mailSubject = encodeURIComponent(`LUTU訂購報價回覆 - ${target.name}`);
                let rawBody = window.generateMailBody(target.name, newTotal, fee, target.details);
                let mailBody = encodeURIComponent(rawBody);
                window.openGmail(target.email, mailSubject, mailBody);
            }

            // [Fix] Persist to Backend!
            fetch(API_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'updateOrderPrice',
                    orderId: orderId,
                    newTotal: newTotal,
                    shippingFee: fee,
                    status: nextStatus
                })
            }).then(() => console.log('Auto-advance status saved')).catch(console.error);

            applyFilter();
            window.lastActiveOrderId = orderId;
            return;
        }

        // Show Modal for Shipping Fee
        showPriceModal(target, nextStatus);
        return; // Stop here, wait for modal callback
    }

    // --- 2. Cutting -> Inspection Safety Check (Profile Deduction) ---
    if (target.status === 'cutting' && nextStatus === 'inspection') {
        // Smart Check: Does order have profiles?
        let details = target.details || "";
        let hasProfiles = (details.includes('【鋁材】') || details.includes('銘材') || details.includes('鋁擠型') || details.includes('鋁材'));

        if (hasProfiles) {
            // Check if deducted
            if (!isProfileDeducted(target)) {
                alert("⚠️ 尚未扣除鋁材庫存！\n\n系統檢測到此訂單包含鋁材，但尚未執行「確認並更新庫存」。\n請先在切料畫面點擊藍色按鈕進行扣帳。");
                return; // Block
            }
        }
    }

    // --- 3. Shipping Safety Check (Accessory Deduction) ---
    // Trigger on ANY transition TO shipping (if not already there)
    if (nextStatus === 'shipping' && target.status !== 'shipping') {

        // [扣庫存核心修復] 依照明細彙整邏輯產生扣除清單
        const deductionMap = new Map();

        // Safety Check: Already deducted?
        if (localStorage.getItem(`deducted_acc_${orderId}`)) {
            console.log("Accessories already deducted for this order. Skipping.");
            const confirmSkip = confirm("⚠️ 注意：系統紀錄顯示此訂單「已扣除」過配件庫存。\n是否直接移至待出貨 (不再重複扣庫存)？");
            if (confirmSkip) {
                target.status = nextStatus;

                // Save Status
                let saved = JSON.parse(localStorage.getItem('order_statuses') || '{}');
                saved[orderId] = nextStatus;
                localStorage.setItem('order_statuses', JSON.stringify(saved));

                applyFilter();
                window.lastActiveOrderId = orderId;
            }
            return;
        }

        const lines = target.details.split('\n'); // Assuming 'lines' should come from target.details

        lines.forEach(line => {
            if (line.includes('【鋁材】') || line.includes('鋁材') || line.includes('鋁擠型') || line.includes('銘材')) return;

            // 1. 解析原始數量
            let qty = 1;
            const qMatch = line.match(/\( x (\d+) \)/);
            if (qMatch) qty = parseInt(qMatch[1]);

            // 2. 獲取品名並偵測系列 (同步 renderDetailCards 邏輯)
            let series = 99;
            let foundKey = Object.keys(PRODUCT_MAP).find(key => line.includes(key));
            if (foundKey) {
                series = parseInt(PRODUCT_MAP[foundKey]);
            }

            let itemName = line.replace(/^【.*?】\s*/, '').replace(/ -- \$[0-9]+/, '').replace(/\( x \d+ \)/, '').trim();

            if (series === 99) {
                series = window.detectSeries(itemName);
            }

            // 3. 合計括號內的零件 (如 M4螺絲x2) -> 跳過平頭螺絲
            window.extractAndAddScrewNutsToMap(itemName, qty, series, deductionMap);

            // 4. 合計主品項 (轉換為標準庫存名稱，如 20-三角連結塊)
            const key = window.getInventoryKey(itemName, series);
            if (key.includes('平頭螺絲')) return; // 個別購買的平頭螺絲也不扣庫存

            const current = deductionMap.get(key) || 0;
            deductionMap.set(key, current + qty);
        });

        const finalDeductList = Array.from(deductionMap.entries()).map(([name, qty]) => ({ name, qty }));

        console.log('📦 最終扣庫存清單:', finalDeductList);

        // Only deduct if accessories exist
        if (finalDeductList.length > 0) {
            if (!window.isProcessing) {
                window.isProcessing = true;
                deductInventory(finalDeductList).then(success => {
                    window.isProcessing = false;
                    if (success) {
                        // Mark as deducted
                        localStorage.setItem(`deducted_acc_${orderId}`, 'true');

                        target.status = nextStatus;
                        applyFilter();
                        window.lastActiveOrderId = orderId;
                        alert("✅ 配件庫存已扣除，訂單移至待出貨。");
                    } else {
                        // Allow force proceed?
                        if (confirm("⚠️ 配件扣除失敗 (可能庫存不足或名稱不符)。\n是否強制移至待出貨？")) {
                            target.status = nextStatus;
                            applyFilter();
                            window.lastActiveOrderId = orderId;
                        }
                    }
                });
            }
            return; // Async wait
        } else {
            // No accessories to deduct, proceed immediately
        }
    }

    // Default Transition (if no special blocks)
    target.status = nextStatus;

    // Save to LocalStorage
    let saved = JSON.parse(localStorage.getItem('order_statuses') || '{}');
    saved[orderId] = nextStatus;
    localStorage.setItem('order_statuses', JSON.stringify(saved));

    // [New] Shipping Email Trigger
    if (nextStatus === 'dispatched' && target.email) {
        let subject = encodeURIComponent(`LUTU鋁圖 - 出貨通知 (${target.name})`);

        // Format details for email
        let formattedDetails = (target.details || "").replace(/\\n/g, '\n').replace(/\n/g, '\n');

        let bodyText = `您好，LUTU鋁圖通知您：您的訂單已出貨。

我們已於今日將您的貨品寄出/準備好。

本次出貨內容如下：
${formattedDetails}

感謝您的訂購！

若有任何問題，歡迎隨時聯繫我們。`;

        let body = encodeURIComponent(bodyText);
        window.openGmail(target.email, subject, body);
    }

    // [Fix] Persist 'completed' status to backend
    if (nextStatus === 'completed') {
        fetch(API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updateOrderPrice',
                orderId: orderId,
                newTotal: target.total, // Keep existing total
                shippingFee: target.shippingFee || 0, // Keep existing fee
                status: 'completed'
            })
        }).then(() => console.log('Completed status saved to backend')).catch(console.error);
    }

    applyFilter();
    window.lastActiveOrderId = orderId;
};

window.toggleCheck = function (el) {
    el.classList.toggle('checked');
    updateCheckProgress();
};

window.updateCheckProgress = function () {
    let total = document.querySelectorAll('.detail-card').length;
    let checked = document.querySelectorAll('.detail-card.checked').length;
    let label = document.getElementById('progress-label');
    if (label) label.innerText = `已核對 ${checked} / ${total}`;

    let pill = document.getElementById('progress-pill');
    if (pill) {
        if (checked === total && total > 0) pill.classList.add('complete');
        else pill.classList.remove('complete');
    }

    let btn = document.getElementById('btn-finish-check');
    if (btn) {
        if (checked === total && total > 0) {
            btn.classList.add('active');
            btn.innerHTML = '<i class="fas fa-check-circle"></i> 確認無誤，關閉視窗';
        } else {
            btn.classList.remove('active');
            btn.innerHTML = '尚有項目未核對 (請點擊上方核對)';
        }
    }
};

window.viewOrder = function (order) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');

    let dateStr = order.timestamp;
    try { dateStr = new Date(order.timestamp).toLocaleString(); } catch (e) { }
    const note = order.note ? order.note : "無";

    window.currentOrderForPrint = order;

    body.innerHTML = `
        <div class="detail-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div class="detail-label">訂單時間</div>
                <button onclick="window.closeModal()" class="btn-close-inline">✖ 關閉</button>
            </div>
            <div class="detail-value" style="margin-top:5px;">${dateStr}</div>
        </div>

        <div style="display:flex; gap:10px;">
            <div class="detail-group" style="flex:1;">
                <div class="detail-label">客戶姓名</div>
                <div class="detail-value">${order.name}</div>
            </div>
            <div class="detail-group" style="flex:1;">
                <div class="detail-label">聯絡電話</div>
                <div class="detail-value">${order.phone}</div>
            </div>
        </div>
        <div class="detail-group">
            <div class="detail-label">配送地址</div>
            <div class="detail-value" style="word-break:break-all;">${order.address}</div>
        </div>
        <div class="detail-group">
            <div class="detail-label">備註事項</div>
            <div class="detail-value" style="color:#666;">${note}</div>
        </div>

        <div class="detail-group" style="background: #fff3e0; padding:10px; border-radius:6px; border:1px solid #ffe0b2;">
            <div class="detail-label" style="color:#e65100;">訂單總額 (含運)</div>
            <div class="detail-value" style="font-size:1.4rem; color:#e65100; font-weight:bold;">${formatPrice(order.total)}</div>
        </div>
        
        <hr style="border:0; border-top:1px dashed #ddd; margin: 15px 0;">
        
        <div class="detail-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                 <div class="detail-label" style="margin-bottom:0;">訂購明細核對</div>
                 <button class="btn-print" onclick="printOrder()"><i class="fas fa-print"></i> 列印撿貨單 (A4)</button>
            </div>
            
            <div style="background:#f9f9f9; padding:5px; border-radius:8px;">
                <div class="checklist-progress-bar" style="${['inspection', 'picking', 'packing'].includes(order.status) ? '' : 'display:none;'}">
                    <div class="progress-text" style="font-size:0.9em;">核對進度</div>
                    <div id="progress-pill" class="progress-pill">
                        <span id="progress-label">0/0</span>
                    </div>
                </div>
                
                <div class="detail-pre" style="padding:10px 0;">
                    ${renderDetailCards(order.details, order.status)}
                </div>
                
                <!-- Explicit Close Buttons -->
                <div style="display:flex; gap:10px; margin-top:10px;">
                     <button onclick="window.closeModal()" style="flex:1; padding:12px; background:#e74c3c; border:none; border-radius:6px; color:#fff; cursor:pointer;">
                        ✖ 關閉視窗
                     </button>
                     ${order.status === 'inspection' ? `
                     <button id="btn-finish-check" class="btn-finish-check" onclick="finishCheck()" style="flex:2; margin-top:0; background:#27ae60;">
                         ✓ 核對完成 → 前進至撿貨單
                     </button>
                     ` : order.status === 'picking' ? `
                     <button id="btn-finish-check" class="btn-finish-check" onclick="finishCheck()" style="flex:2; margin-top:0; background:#27ae60;">
                         ✓ 核對完成 → 前進至包裝
                     </button>
                     ` : order.status === 'packing' ? `
                     <button id="btn-finish-check" class="btn-finish-check" onclick="finishCheck()" style="flex:2; margin-top:0; background:#27ae60;">
                         ✓ 核對完成 → 前進至待出貨
                     </button>
                     ` : ''}
                </div>
            </div>
        </div>
    `;
    updateCheckProgress();
    modal.style.display = 'flex';
};

const PRODUCT_MAP = {
    "2020歐規鋁擠型 (輕量型)": "20", "2020歐規鋁擠型 (標準型)": "20", "2040歐規鋁擠型 (輕量型)": "20",
    "2040歐規鋁擠型 (標準型)": "20", "2060歐規鋁擠型 (標準型)": "20", "2080歐規鋁擠型 (標準型)": "20",
    "3030歐規鋁擠型 (輕量型)": "30", "3030歐規鋁擠型 (標準型)": "30", "3030歐規封閉鋁擠型 (輕量型)": "30",
    "3030歐規雙封閉鋁擠型 (輕量型)": "30", "3030歐規三封閉鋁擠型 (輕量型)": "30", "3060歐規鋁擠型 (標準型)": "30",
    "3060歐規封閉鋁擠型 (標準型)": "30", "3090歐規鋁擠型 (標準型)": "30", "6060歐規鋁擠型 (標準型)": "30",
    "4040歐規鋁擠型 (輕量型)": "40", "4040歐規鋁擠型 (標準型)": "40", "4040歐規封閉鋁擠型 (標準型)": "40",
    "4080歐規鋁擠型 (輕量型)": "40", "4080歐規鋁擠型 (標準型)": "40", "4080歐規封閉鋁擠型 (標準型)": "40",
    "8080歐規鋁擠型 (標準型)": "40",
    "2020雙蓋封頭": "20", "2040雙蓋封頭": "20", "2020單蓋封頭": "20", "M5滑塊螺母": "20",
    "M4滑塊螺母": "20", "M3滑塊螺母": "20", "M5彈片螺母": "20", "M4彈片螺母": "20", "M3彈片螺母": "20",
    "2020直角連接座 (鋅合金)": "20", "2020直角連接座 (鋁合金)": "20", "2020角槽連接座": "20",
    "2020內置連接件 (L型)": "20", "2020內置連接件 (一字型)": "20", "2020三維連接座": "20",
    "2020任意角度連接座": "20", "2020活動鉸鏈": "20", "2020把手": "20", "2020門吸": "20", "2020地腳": "20",
    "2020腳輪": "20", "20一字連接片": "20", "20L型連接片": "20", "20T型連接片": "20", "20十字連接片": "20",
    "M4六角螺絲": "20", "M4螺母": "20", "三角連結塊(含M4螺絲x2,M4螺母x2)": "20", "平板連結片(含M4螺絲x2,M4螺母x2)": "20",
    "L層板架(含M4螺絲x2,M4螺母x2)": "20", "轉向連結塊(含M4螺絲x2,M4螺母x2)": "20", "絞鍊(含M4螺絲x4,M4螺母x4)": "20",
    "20隱式層板架": "20", "合金把手(含M4螺絲x2,M4螺母x2)": "20", "3mm六角板手": "20",
    "3030單蓋封頭": "30", "3060雙蓋封頭": "30", "3030雙蓋封頭": "30", "M6滑塊螺母": "30",
    "M5滑塊螺母(30用)": "30", "M4滑塊螺母(30用)": "30", "M6彈片螺母": "30", "M5彈片螺母(30用)": "30",
    "M4彈片螺母(30用)": "30", "M3彈片螺母(30用)": "30", "3030直角連接座 (鋅合金)": "30",
    "3030直角連接座 (鋁合金)": "30", "3030強利角件": "30", "3060強利角件": "30", "3030角槽連接座": "30",
    "3030內置連接件 (L型)": "30", "3030內置連接件 (一字型)": "30", "3030三維連接座": "30",
    "3030任意角度連接座": "30", "3030活動鉸鏈": "30", "3030金屬鉸鏈": "30", "3030把手": "30",
    "3030門吸": "30", "3030蹄腳": "30", "3030腳輪": "30", "30一字連接片": "30", "30L型連接片": "30",
    "30T型連接片": "30", "30十字連接片": "30", "30135度連接片": "30", "3045度連接片": "30",
    "M6六角螺絲": "30", "M6螺母": "30", "三角連結塊(含M6螺絲x2,M6螺母x2)": "30", "平板連結片(含M6螺絲x2,M6螺母x2)": "30",
    "L層板架(含M6螺絲x2,M6螺母x2)": "30", "轉向連結塊(含M6螺絲x2,M6螺母x2)": "30", "180度連接板(含M6螺絲x4,M6螺母x4)": "30",
    "靜音輪腳架固定器(含M6螺絲x2,M6螺母x2)": "30", "絞鍊(含M6螺絲x4,M6螺母x4)": "30", "30隱式層板架": "30",
    "180度連結器(含M6螺絲x2,M6螺母x2)": "30", "金屬端蓋(含M6平頭螺絲x1)": "30", "30靜音輪": "30", "30腳架": "30",
    "合金把手(含M6螺絲x2,M6螺母x2)": "30", "5mm六角板手": "30",
    "4040單蓋封頭": "40", "4080雙蓋封頭": "40", "4040雙蓋封頭": "40", "M8滑塊螺母": "40",
    "M6滑塊螺母(40用)": "40", "M5滑塊螺母(40用)": "40", "M4滑塊螺母(40用)": "40", "M8彈片螺母": "40",
    "M6彈片螺母(40用)": "40", "M5彈片螺母(40用)": "40", "M4彈片螺母(40用)": "40",
    "4040直角連接座 (鋅合金)": "40", "4040直角連接座 (鋁合金)": "40", "4040強利角件": "40",
    "4080強利角件": "40", "4040角槽連接座": "40", "4040內置連接件 (L型)": "40",
    "4040內置連接件 (一字型)": "40", "4040三維連接座": "40", "4040任意角度連接座": "40",
    "4040活動鉸鏈": "40", "4040金屬鉸鏈": "40", "4040把手": "40", "4040門吸": "40", "4040蹄腳": "40",
    "4040腳輪": "40", "40一字連接片": "40", "40L型連接片": "40", "40T型連接片": "40", "40十字連接片": "40",
    "40135度連接片": "40", "4045度連接片": "40",
    "M8六角螺絲": "40", "M8螺母": "40", "三角連結塊(含M8螺絲x2,M8螺母x2)": "40", "平板連結片(含M8螺絲x2,M8螺母x2)": "40",
    "L層板架(含M8螺絲x2,M8螺母x2)": "40", "轉向連結塊(含M8螺絲x2,M8螺母x2)": "40", "180度連接板(含M8螺絲x4,M8螺母x4)": "40",
    "靜音輪腳架固定器(含M8螺絲x2,M8螺母x2)": "40", "絞鍊(含M8螺絲x4,M8螺母x4)": "40", "40隱式層板架": "40",
    "180度連結器(含M8螺絲x2,M8螺母x2)": "40", "金屬端蓋(含M8平頭螺絲x1)": "40", "40靜音輪": "40", "40腳架": "40",
    "合金把手組(含M8螺絲x2,M8螺母x2)": "40", "6mm六角板手": "40"
};

// --- Global Parsing Tools ---

window.detectSeries = function (name) {
    if (name.match(/^20/)) return 20;
    if (name.match(/^30/)) return 30;
    if (name.match(/^40/) || name.match(/^80/)) return 40;
    if (name.includes('M3') || name.includes('M4') || name.includes('M5')) return 20;
    if (name.includes('M6')) return 30;
    if (name.includes('M8')) return 40;
    if (name.includes('3mm')) return 20;
    if (name.includes('5mm')) return 30;
    if (name.includes('6mm')) return 40;
    return 99;
};

window.normalizeScrewName = function (name) {
    let n = name.trim();
    n = n.replace(/M(\d+)螺絲/, 'M$1六角螺絲');
    return n;
};

window.convertToInventoryKey = function (name, series) {
    let cleanName = name.replace(/\(含[^)]+\)/g, '').trim();
    // 統一命名：合金把手組 -> 合金把手 (對齊 Google Sheet)
    cleanName = cleanName.replace('合金把手組', '合金把手');

    // 移除前綴（包含可選的連字符或空格），避免雙重連字符 (如 30-靜音輪 -> 30--靜音輪)
    cleanName = cleanName.replace(/^(20|30|40|80)[-\s]?/, '').trim();
    cleanName = window.normalizeScrewName(cleanName);
    if (series !== 99) return `${series}-${cleanName}`;
    return cleanName;
};

window.isScrewOrNut = function (name) {
    const n = name.toLowerCase();
    return n.includes('螺絲') || n.includes('螺母') || n.includes('螺帽') || n.includes('滑塊') || n.includes('彈片');
};

window.extractAndAddScrewNutsToMap = function (name, qty, series, totalsMap) {
    const match = name.match(/\(含([^)]+)\)/);
    if (!match) return;
    const componentStr = match[1];
    const parts = componentStr.split(/[,，]/);
    parts.forEach(part => {
        const compMatch = part.trim().match(/^(.+?)x(\d+)$/);
        if (compMatch) {
            let compName = compMatch[1].trim();
            const compQty = parseInt(compMatch[2]) * qty;
            if (compName.includes('平頭螺絲')) return;
            compName = window.normalizeScrewName(compName);
            const inventoryKey = `${series}-${compName}`;
            const current = totalsMap.get(inventoryKey) || 0;
            totalsMap.set(inventoryKey, current + compQty);
        }
    });
};

// === SKU Code Support Functions ===

/**
 * 從品項名稱中提取 SKU 編碼
 * @param {string} name - 品項名稱（可能含 SKU）
 * @returns {string|null} - SKU 編碼或 null
 * @example parseSKU("20-三角連結塊 [L-001]") => "L-001"
 */
window.parseSKU = function (name) {
    const match = name.match(/\s*\[([\w-]+)\]\s*$/);
    return match ? match[1] : null;
};

/**
 * 移除品項名稱中的 SKU 編碼
 * @param {string} name - 品項名稱（可能含 SKU）
 * @returns {string} - 移除 SKU 後的名稱
 * @example removeSKU("20-三角連結塊 [L-001]") => "20-三角連結塊"
 */
window.removeSKU = function (name) {
    return name.replace(/\s*\[[\w-]+\]\s*$/g, '').trim();
};

/**
 * 模糊匹配庫存項目（忽略 SKU 編碼，向後兼容）
 * @param {string} generatedKey - 系統產生的標準鍵值（如 "20-三角連結塊"）
 * @param {Array} inventoryList - 庫存陣列
 * @returns {Object|null} - 匹配的庫存項目或 null
 */
window.fuzzyMatchInventoryKey = function (generatedKey, inventoryList) {
    if (!inventoryList || !Array.isArray(inventoryList)) return null;

    // Helper: 取得品項名稱（兼容多種欄位名）
    const getName = (item) => (item.name || item.品項名稱 || item['品項名稱'] || "").toString().trim();

    // 1. 精確匹配（向後兼容舊格式，無 SKU）
    let exactMatch = inventoryList.find(item => getName(item) === generatedKey);
    if (exactMatch) return exactMatch;

    // 2. 模糊匹配：移除 SKU 編碼後比對（支援新格式）
    let fuzzyMatch = inventoryList.find(item => {
        let invName = getName(item);
        let nameWithoutSKU = window.removeSKU(invName);
        return nameWithoutSKU === generatedKey;
    });

    return fuzzyMatch || null;
};


function renderDetailCards(detailsStr, status) {
    if (!detailsStr) return "無明細";
    let lines = detailsStr.split(/\\n|\n/).filter(l => l.trim().length > 0);

    // 螺絲螺帽彙總 Map (key: 庫存鍵值, value: 數量)
    const screwNutTotals = new Map();

    // 第一輪：收集所有項目並進行分類與合計
    let normalItems = [];

    lines.forEach(line => {
        let type = 'other';
        let series = 99;
        let qty = 1;

        // 解析數量
        const qtyMatch = line.match(/\( x (\d+) \)/);
        if (qtyMatch) {
            qty = parseInt(qtyMatch[1]);
        }

        // 基本類型判斷
        if (line.includes('【鋁材】') || line.includes('鋁材') || line.includes('鋁擠型')) type = 'profile';
        else if (line.includes('【配件】') || line.includes('配件')) type = 'accessory';

        // 嘗試從地名偵測系列
        let foundKey = Object.keys(PRODUCT_MAP).find(key => line.includes(key));
        if (foundKey) {
            series = parseInt(PRODUCT_MAP[foundKey]);
            if (foundKey.includes('鋁擠型')) type = 'profile';
        }

        let itemName = line.replace(/^【.*?】\s*/, '').trim();
        itemName = itemName.replace(/\( x \d+ \)/, '').trim();
        itemName = itemName.replace(/ -- \$[0-9]+/, '').trim();

        if (series === 99) {
            series = window.detectSeries(itemName);
        }

        // 如果包含螺絲相關關鍵字，即使沒有標籤也優先歸類為 accessory 進行合計
        if (window.isScrewOrNut(itemName)) {
            type = 'accessory';
        } else if (type === 'other' && series !== 99) {
            type = 'accessory';
        }

        if (type === 'accessory') {
            // 收集配件內含的螺絲螺帽到彙總
            window.extractAndAddScrewNutsToMap(itemName, qty, series, screwNutTotals);

            // 轉換為庫存鍵值格式
            const inventoryKey = window.convertToInventoryKey(itemName, series);

            // 判斷是否為螺絲螺帽類商品（進行合計）
            if (window.isScrewOrNut(itemName)) {
                const current = screwNutTotals.get(inventoryKey) || 0;
                screwNutTotals.set(inventoryKey, current + qty);
            } else {
                // 查找 SKU
                let sku = '';
                if (window.allInventory) {
                    const matchItem = window.fuzzyMatchInventoryKey(inventoryKey, window.allInventory);
                    if (matchItem) {
                        const pname = (matchItem.name || matchItem.品項名稱 || "").toString();
                        sku = window.parseSKU(pname) || '';
                    }
                }
                const skuHtml = sku ? ` <span style="font-size:0.85em; color:#999; font-weight:bold;">[${sku}]</span>` : '';

                // 非螺絲螺帽的配件，加入 normalItems
                let formatted = `【配件】 <span style="color:#2980b9; font-weight:bold;">${inventoryKey}</span>${skuHtml}`;
                if (qtyMatch) {
                    formatted += ` <span style="color:#000; font-weight:bold;">( x ${qty} )</span>`;
                }
                normalItems.push({
                    raw: formatted,
                    type: type,
                    series: series,
                    seriesClass: (series !== 99) ? `series-${series}` : ''
                });
            }
        } else {
            // 鋁材項目
            let formatted = line.replace(/ -- \$[0-9]+/, '').trim();
            formatted = formatted.replace(/\( x ([0-9]+) \)/, '___QTY_BLOCK_$1___');
            formatted = formatted.replace(/\(L=([0-9]+)cm\)/, '___LEN_BLOCK_$1___');
            formatted = formatted.replace(/\(長度([0-9]+)cm\)/, '___LEN_BLOCK_$1___');
            formatted = formatted.replace(/___QTY_BLOCK_([0-9]+)___/, '<span style="color:#000; font-weight:bold;">( x $1 )</span>');
            formatted = formatted.replace(/___LEN_BLOCK_([0-9]+)___/, '<span style="color:#c0392b; font-weight:bold;">(長度$1cm)</span>');

            // 查找鋁材 SKU
            let sku = '';
            if (window.allInventory) {
                // 1. 移除長度資訊和所有括號內容來取得純品名
                // 例如: "3030輕型 (長度30cm)" -> "3030輕型"
                let lookupName = itemName.replace(/\(長度.*?\)/, '')
                    .replace(/\(L=.*?\)/, '')
                    .replace(/\(.*?\)/g, '') // 移除其他括號
                    .trim();

                // 嘗試1: 標準庫存鍵值 (例如 30-3030輕型)
                let lookupKey1 = window.convertToInventoryKey(lookupName, series);

                // 嘗試2: 純名稱 (例如 3030輕型)
                let lookupKey2 = lookupName;

                // 執行搜尋 (優先嘗試帶前綴，失敗則嘗試純名)
                let matchItem = window.fuzzyMatchInventoryKey(lookupKey1, window.allInventory);

                if (!matchItem) {
                    matchItem = window.fuzzyMatchInventoryKey(lookupKey2, window.allInventory);
                }

                if (matchItem) {
                    const pname = (matchItem.name || matchItem.品項名稱 || "").toString();
                    sku = window.parseSKU(pname) || '';
                }
            }
            const skuHtml = sku ? ` <span style="font-size:0.85em; color:#999; font-weight:bold;">[${sku}]</span>` : '';

            // 將 SKU 插入在長度資訊之前，或者名稱之後
            if (skuHtml) {
                // 嘗試插入在 "【鋁材】 品名" 之後，長度之前
                // 這裡簡單做：如果有長度區塊，插在它前面；如果沒有，插在最後
                if (formatted.includes('<span style="color:#c0392b;')) {
                    formatted = formatted.replace('<span style="color:#c0392b;', `${skuHtml} <span style="color:#c0392b;`);
                } else {
                    formatted += skuHtml;
                }
            }

            normalItems.push({
                raw: formatted,
                type: type,
                series: series,
                seriesClass: (series !== 99) ? `series-${series}` : ''
            });
        }
    });

    // 將彙總的螺絲螺帽轉換為項目
    screwNutTotals.forEach((qty, key) => {
        const seriesMatch = key.match(/^(\d+)-/);
        const seriesNum = seriesMatch ? parseInt(seriesMatch[1]) : 99;

        // 查找 SKU
        let sku = '';
        if (window.allInventory) {
            const matchItem = window.fuzzyMatchInventoryKey(key, window.allInventory);
            if (matchItem) {
                const pname = (matchItem.name || matchItem.品項名稱 || "").toString();
                sku = window.parseSKU(pname) || '';
            }
        }
        const skuHtml = sku ? ` <span style="font-size:0.85em; color:#999; font-weight:bold;">[${sku}]</span>` : '';

        const formatted = `【配件】 <span style="color:#e74c3c; font-weight:bold;">🔩 ${key}</span>${skuHtml} <span style="color:#000; font-weight:bold;">( x ${qty} )</span>`;

        normalItems.push({
            raw: formatted,
            type: 'accessory',
            series: seriesNum,
            seriesClass: (seriesNum !== 99) ? `series-${seriesNum}` : '',
            isScrewNut: true
        });
    });

    // 排序邏輯：鋁材 > 配件（一般）> 螺絲螺帽
    normalItems.sort((a, b) => {
        const getRank = (item) => {
            if (item.type === 'profile') return 1;
            if (item.type === 'accessory' && !item.isScrewNut) return 2;
            if (item.type === 'accessory' && item.isScrewNut) return 3;
            return 4;
        };
        let rankA = getRank(a);
        let rankB = getRank(b);
        if (rankA !== rankB) return rankA - rankB;
        if (a.series !== b.series) return a.series - b.series;
        return a.raw.localeCompare(b.raw, 'zh-TW'); // 同系列按名稱排序
    });

    let html = '';
    let lastType = '';
    let lastSeries = -1;
    let enteredScrewNutSection = false;

    normalItems.forEach((item, index) => {
        // 配件區大標題
        if (lastType === 'profile' && item.type === 'accessory' && !item.isScrewNut) {
            html += `<div style="height:40px; border-top:1px dashed #999; margin-top:20px; margin-bottom:20px; position:relative; text-align:center;">
                        <span style="position:absolute; top:-12px; left:50%; transform:translateX(-50%); background:#fff; padding:0 10px; color:#666; font-size:0.9rem; font-weight:bold;">配件區</span>
                    </div>`;
        }

        // 螺絲螺帽合計區分隔線
        if (item.isScrewNut && !enteredScrewNutSection) {
            html += `<div style="height:40px; border-top:2px dashed #e74c3c; margin-top:20px; margin-bottom:20px; position:relative; text-align:center;">
                        <span style="position:absolute; top:-12px; left:50%; transform:translateX(-50%); background:#fff; padding:0 10px; color:#e74c3c; font-size:0.9rem; font-weight:bold;">🔩 螺絲螺帽（已合計）</span>
                    </div>`;
            enteredScrewNutSection = true;
        }
        else if (!item.isScrewNut && index > 0 && item.series !== lastSeries && item.type === 'accessory') {
            // 同系列配件內部的微小間隔
            html += `<div style="height:15px;"></div>`;
        }

        const isInteractive = ['inspection', 'picking', 'packing'].includes(status);
        const cardAttr = isInteractive ? `onclick="toggleCheck(this)"` : '';

        html += `
        <div class="detail-card ${item.seriesClass}" ${cardAttr}>
            ${isInteractive ? `
            <div class="check-box">
                <i class="fas fa-check" style="display:none; color:white;"></i>
            </div>
            ` : ''}
            <div class="d-name">${item.raw}</div>
        </div>`;

        lastType = item.type;
        lastSeries = item.series;
    });

    return html;
}


window.printOrder = function () {
    if (!window.currentOrderForPrint) { alert("無法取得訂單資料"); return; }
    let order = window.currentOrderForPrint;

    let detailsStr = order.details || "";
    let lines = detailsStr.split(/\\n|\n/).filter(l => l.trim().length > 0);

    const screwNutTotals = new Map();
    let items = [];

    // 第一輪：與 renderDetailCards 相同的邏輯
    lines.forEach(line => {
        let type = 'other';
        let series = 99;
        let qty = 1;

        const qtyMatch = line.match(/\( x (\d+) \)/);
        if (qtyMatch) qty = parseInt(qtyMatch[1]);

        if (line.includes('【鋁材】') || line.includes('鋁材') || line.includes('鋁擠型')) type = 'profile';
        else if (line.includes('【配件】') || line.includes('配件')) type = 'accessory';

        let foundKey = Object.keys(PRODUCT_MAP).find(key => line.includes(key));
        if (foundKey) {
            series = parseInt(PRODUCT_MAP[foundKey]);
            if (foundKey.includes('鋁擠型')) type = 'profile';
        }

        let itemName = line.replace(/^【.*?】\s*/, '').trim();
        itemName = itemName.replace(/\( x \d+ \)/, '').trim();
        itemName = itemName.replace(/ -- \$[0-9]+/, '').trim();

        if (series === 99) series = window.detectSeries(itemName);

        if (window.isScrewOrNut(itemName)) {
            type = 'accessory';
        } else if (type === 'other' && series !== 99) {
            type = 'accessory';
        }

        if (type === 'accessory') {
            window.extractAndAddScrewNutsToMap(itemName, qty, series, screwNutTotals);
            const inventoryKey = window.convertToInventoryKey(itemName, series);

            if (window.isScrewOrNut(itemName)) {
                const current = screwNutTotals.get(inventoryKey) || 0;
                screwNutTotals.set(inventoryKey, current + qty);
            } else {
                let raw = `【配件】 <b>${inventoryKey}</b> (x${qty})`;
                items.push({ raw, type, series });
            }
        } else {
            let formatted = line.replace(/ -- \$[0-9]+/, '').trim();
            formatted = formatted.replace(/\( x ([0-9]+) \)/, '<b>(x$1)</b>');
            formatted = formatted.replace(/\(L=([0-9]+)cm\)/, '<b style="color:#c0392b">($1cm)</b>');
            formatted = formatted.replace(/\(長度([0-9]+)cm\)/, '<b style="color:#c0392b">($1cm)</b>');
            items.push({ raw: formatted, type, series });
        }
    });

    // 加入合計後的螺絲螺帽
    screwNutTotals.forEach((qty, key) => {
        const seriesMatch = key.match(/^(\d+)-/);
        const seriesNum = seriesMatch ? parseInt(seriesMatch[1]) : 99;
        const raw = `【配件】 <b style="color:#e74c3c">🔩 ${key}</b> <b>(x${qty})</b>`;
        items.push({ raw, type: 'accessory', series: seriesNum, isScrewNut: true });
    });

    let list20 = items.filter(i => i.series === 20 || i.series > 40 || i.series < 20);
    let list30 = items.filter(i => i.series === 30);
    let list40 = items.filter(i => i.series === 40);

    const renderList = (list, title, color) => {
        if (list.length === 0) return '';
        // 排序：鋁材 > 配件 > 螺絲螺帽
        list.sort((a, b) => {
            const getRank = (item) => {
                if (item.type === 'profile') return 1;
                if (item.type === 'accessory' && !item.isScrewNut) return 2;
                return 3;
            };
            return getRank(a) - getRank(b);
        });

        let html = `<div class="print-column" style="border-top: 3px solid ${color};">`;
        html += `<div style="background:${color}; color:#fff; text-align:center; font-weight:bold; font-size: 11px; padding:2px;">${title}</div>`;
        html += `<div style="padding:4px;">`;
        list.forEach(item => {
            html += `<div class="print-item">`;
            html += `<span class="check-box"></span>`;
            html += `<span class="item-text">${item.raw}</span>`;
            html += `</div>`;
        });
        html += `</div></div>`;
        return html;
    };

    let html20 = renderList(list20, "20 系列", "#3498db");
    let html30 = renderList(list30, "30 系列", "#e67e22");
    let html40 = renderList(list40, "40 系列", "#27ae60");

    let printWindow = window.open('', '', 'width=1100,height=800');
    // ULTRA COMPACT CSS
    printWindow.document.write(`
        <html>
        <head>
            <title>撿貨單 - ${order.name}</title>
            <style>
                @page { size: A4 landscape; margin: 5mm; }
                body { font-family: "Noto Sans TC", sans-serif; margin: 0; padding: 5px; font-size: 10px; }
                .header { display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #333; padding-bottom: 2px; margin-bottom: 5px; }
                .h-left { font-size: 1.1em; font-weight: bold; }
                .h-right { text-align: right; font-size: 0.9em; }
                .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; align-items: start; }
                .print-column { border: 1px solid #ccc; break-inside: avoid; background: #fff; }
                .print-item { display: flex; align-items: flex-start; border-bottom: 1px dotted #ccc; padding: 2px 0; line-height: 1.2; }
                .check-box { width: 10px; height: 10px; border: 1px solid #333; margin-right: 4px; margin-top: 1px; flex-shrink: 0; }
                .item-text { flex: 1; word-break: break-all; }
                b { font-weight: 800; }
                @media print { .no-print { display: none; } }
                .no-print { position: fixed; top: 10px; right: 10px; background: #e74c3c; color: white; padding: 10px 20px; font-size: 16px; border: none; cursor: pointer; border-radius: 4px; z-index: 1000; }
            </style>
        </head>
        <body>
            <button class="no-print" onclick="window.close()">✖ 關閉預覽</button>
            <div class="header">
                <div class="h-left">LUTU 鋁圖 (${order.name}) <span style="font-weight:normal;">${order.phone}</span></div>
                <div class="h-right">
                    ${new Date(order.timestamp).toLocaleString()} | ${order.address}
                </div>
            </div>
            
            <div class="grid">
                ${html20}
                ${html30}
                ${html40}
            </div>
            
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
};

// --- Inventory Deduction Logic ---

async function deductInventory(items) {
    // items: [{name: "...", qty: 5}, ...] - names are ALREADY STANDARDIZED keys

    // Convert to payload directly
    let payloadItems = items.map(i => {
        return {
            name: i.name, // Already standardized
            qty: i.qty,
            originalName: i.name // For debug
        };
    });

    // Send to GAS
    // Use proper CORS mode 'no-cors' if just firing, but we want response?
    // GAS Web App usually allows CORS if deployed as "Me" and "Anyone".

    try {
        const res = await fetch(ADMIN_API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "deductInventory",
                items: payloadItems
            })
            // mode: 'cors' is default
        });
        const json = await res.json();

        if (json.status === 'success') {
            console.log("Inventory Deducted:", json);
            return true;
        } else {
            alert("庫存扣除失敗: " + (json.message || "未知錯誤"));
            console.error("Deduct Error", json);
            return false;
        }
    } catch (e) {
        console.error("Fetch Error", e);
        // Sometimes CORS fail but request works (opaque). 
        // But we rely on JSON response. Assuming GAS is set up correctly.
        alert("連線錯誤 (扣庫存): " + e.message);
        return false;
    }
}

// --- Inventory Management Functions ---

window.fetchInventoryData = async function () {
    const container = document.getElementById('inventory-content');
    if (!container) return;

    container.innerHTML = `<div style="text-align:center; padding:50px; color:#999;"><i class="fas fa-spinner fa-spin"></i> 資料載入中...</div>`;

    console.log("Fetching inventory data from:", ADMIN_API_URL);
    try {
        const res = await fetch(ADMIN_API_URL + "?action=getInventory&t=" + new Date().getTime());
        if (!res.ok) throw new Error("HTTP連線錯誤: " + res.status);

        const json = await res.json();
        console.log("Raw Inventory JSON:", json);

        // Robust Data Extraction
        let data = null;
        if (Array.isArray(json)) {
            data = json;
        } else if (json && Array.isArray(json.inventory)) {
            data = json.inventory;
        } else if (json && json.status === 'success' && Array.isArray(json.data)) {
            data = json.data;
        }

        if (data && data.length > 0) {
            console.log("Extracted Item 0 Keys:", Object.keys(data[0]));
            console.log("Extracted Item 0 Sample:", data[0]);
            window.allInventory = data;
            renderInventory(data);
        } else {
            console.error("Unknown Inventory Data Format:", json);
            container.innerHTML = `<div style="color:red; text-align:center; padding:20px;">資料格式無法解析（請檢查 Google Apps Script 回傳格式）</div>`;
        }
    } catch (e) {
        console.error("Inventory fetch failed:", e);
        container.innerHTML = `<div style="color:red; text-align:center; padding:20px;">連線失敗，請檢查網路或系統狀態。<br><small>${e.message}</small></div>`;
    }
};

window.currentInventoryCategory = 'aluminum';
window.currentInventorySeries = 'all';

// Strict list of aluminum profiles based on user spreadsheet
const ALUMINUM_ALLOW_LIST = [
    "2020型", "2040型",
    "3030輕型", "3060輕型", "3030重型", "3060重型",
    "4040輕型", "4080輕型", "4040重型", "4080重型"
];

window.switchInventoryCategory = function (category) {
    const hub = document.getElementById('inventory-hub');
    const details = document.getElementById('inventory-details');
    if (!hub || !details) return;

    hub.classList.add('hidden');
    details.classList.remove('hidden');

    window.currentInventoryCategory = category;

    // Update Title and Sub-filters
    const titleEl = document.getElementById('inventory-view-title');
    const seriesFilters = document.getElementById('aluminum-series-filters');

    if (category === 'aluminum') {
        if (titleEl) titleEl.innerHTML = `<i class="fas fa-layer-group"></i> 鋁材庫存概覽`;
        if (seriesFilters) seriesFilters.style.display = 'flex';
    } else {
        if (titleEl) titleEl.innerHTML = `<i class="fas fa-tools"></i> 配件庫存概覽`;
        if (seriesFilters) seriesFilters.style.display = 'none';
        window.currentInventorySeries = 'all';
    }

    filterInventory();
};

window.backToInventoryHub = function () {
    const hub = document.getElementById('inventory-hub');
    const details = document.getElementById('inventory-details');
    if (hub && details) {
        hub.classList.remove('hidden');
        details.classList.add('hidden');
    }
};

window.filterBySeries = function (series, btn) {
    document.querySelectorAll('#aluminum-series-filters .filter-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    window.currentInventorySeries = series;
    filterInventory();
};

window.filterInventory = function () {
    if (!window.allInventory) return;
    const searchTerm = (document.getElementById('inventory-search')?.value || "").toLowerCase();
    const category = window.currentInventoryCategory;
    const series = window.currentInventorySeries;

    const filtered = window.allInventory.filter(item => {
        // Use the same robust key detection for filtering
        const name = ((() => {
            const keys = ['name', '品項名稱', '品項'];
            const objKeys = Object.keys(item);
            for (const k of objKeys) {
                if (keys.some(target => target.toLowerCase() === k.trim().toLowerCase())) return item[k];
            }
            return "";
        })()).toString().trim();

        const matchesSearch = name.toLowerCase().includes(searchTerm);

        // Tier 1: Category Check (Strict)
        const isAluminum = ALUMINUM_ALLOW_LIST.some(model => name.includes(model));
        const matchesCategory = (category === 'aluminum') ? isAluminum : !isAluminum;

        // Tier 2: Series Check (only for aluminum)
        let matchesSeries = true;
        if (category === 'aluminum' && series !== 'all') {
            matchesSeries = name.includes(series);
        }

        return matchesSearch && matchesCategory && matchesSeries;
    });

    renderInventory(filtered, false); // Update stats based on filtered view
};

function renderInventory(inventory, isPartial = false) {
    const container = document.getElementById('inventory-content');
    const statsContainer = document.getElementById('inventory-stats');
    if (!container) return;

    // Helper to find value by multiple possible keys (ignoring spaces/case/partial)
    const findValue = (obj, keys) => {
        const objKeys = Object.keys(obj);
        // 1. Exact or Trimmed Match
        for (const k of objKeys) {
            const cleanK = k.trim().toLowerCase();
            if (keys.some(target => target.trim().toLowerCase() === cleanK)) return obj[k];
        }
        // 2. Partial Match (catch "數量(cm)" or "庫存總量")
        for (const k of objKeys) {
            const cleanK = k.trim().toLowerCase();
            if (keys.some(target => cleanK.includes(target.toLowerCase()) || target.toLowerCase().includes(cleanK))) {
                return obj[k];
            }
        }
        return undefined;
    };

    // Helper to parse numeric values (handles commas)
    const parseNum = (val) => {
        if (val === undefined || val === null) return 0;
        const str = val.toString().replace(/,/g, '').trim();
        return parseFloat(str) || 0;
    };

    // Update Stats if it's a full reload or from global data
    // ONLY show stats for Aluminum category
    const currentCat = window.currentInventoryCategory || 'aluminum';

    // 【修正】統計數字應該基於過濾後的數據
    // 先過濾出實際顯示的項目，再計算統計
    const validItems = inventory.filter(item => {
        const name = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();
        if (!name || name === '') return false;

        const isAluminum = ALUMINUM_ALLOW_LIST.some(model => name.includes(model));

        // 根據當前分類過濾
        if (currentCat === 'aluminum' && !isAluminum) return false;
        if (currentCat === 'accessory' && isAluminum) return false;

        // 配件額外過濾前端顯示行
        if (!isAluminum) {
            const isBackendRow = name.match(/^(20|30|40)-/);
            if (!isBackendRow) return false;
        }

        return true;
    });

    if (statsContainer && !isPartial && currentCat === 'aluminum') {
        let totalStockBars = 0;
        let totalOffcuts = 0;

        validItems.forEach(item => {
            const rawStock = parseNum(findValue(item, ['qty', 'stock', '庫存數量', '數量', '庫存']));
            totalStockBars += Math.floor(rawStock / 600);

            const offcutsStr = (findValue(item, ['offcuts', '餘料', '備註']) || "").toString();
            if (offcutsStr) {
                const offcuts = offcutsStr.split(/[,，、 ]+/).reduce((acc, s) => {
                    let num = parseFloat(s.trim());
                    if (!isNaN(num) && num > 0 && num < 600) acc++;
                    return acc;
                }, 0);
                totalOffcuts += offcuts;
            }
        });

        statsContainer.innerHTML = `
            <div class="stat-pill">
                <span class="stat-label">品項總數</span>
                <span class="stat-value">${validItems.length} 種</span>
            </div>
            <div class="stat-pill">
                <span class="stat-label">標準料總量</span>
                <span class="stat-value">${totalStockBars} 支</span>
            </div>
            <div class="stat-pill">
                <span class="stat-label">餘料總數</span>
                <span class="stat-value">${totalOffcuts} 支</span>
            </div>
        `;
    }

    if (!Array.isArray(inventory) || inventory.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:50px; color:#999; border: 1px dashed #ddd; border-radius:8px;">沒有符合搜尋條件的庫存資料</div>';
        return;
    }

    // Hide stats container for accessories
    if (statsContainer && window.currentInventoryCategory === 'accessory') {
        statsContainer.style.display = 'none';
    } else if (statsContainer) {
        statsContainer.style.display = 'flex';
    }

    // 【關鍵修復】清空容器，防止舊數據殘留
    container.innerHTML = '';

    let html = '<div class="inventory-grid">';

    let accessoryIndex = 0; // Track index for accessories only (重置)

    // 先對配件進行分組（按商品類型）
    const accessoryGroups = new Map(); // key: baseName, value: array of items with different series
    const aluminumItems = [];

    inventory.forEach(item => {
        const name = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();
        const isAluminum = ALUMINUM_ALLOW_LIST.some(model => name.includes(model));

        // 過濾前端顯示行
        if (!isAluminum && !name.match(/^(20|30|40)-/)) return;

        if (isAluminum) {
            aluminumItems.push(item);
        } else {
            // 配件：提取基礎名稱（去掉系列前綴和SKU）
            let baseName = window.removeSKU(name).replace(/^(20|30|40|80)-/, '').trim();

            // 【統一螺絲螺母板手】移除規格前綴
            // M4/M6/M8六角螺絲 → 六角螺絲
            // M4/M6/M8螺母 → 螺母
            // 3mm/5mm/6mm六角板手 → 六角板手
            baseName = baseName.replace(/^M\d+/, '').trim();     // 移除 M4, M6, M8
            baseName = baseName.replace(/^\d+mm/, '').trim();    // 移除 3mm, 5mm, 6mm

            if (!accessoryGroups.has(baseName)) {
                accessoryGroups.set(baseName, []);
            }
            accessoryGroups.get(baseName).push(item);
        }
    });

    // 排序鋁材（原邏輯）
    const sortedAluminum = aluminumItems.sort((a, b) => {
        const nameA = (findValue(a, ['name', '品項名稱', '品項']) || "").toString().trim();
        const nameB = (findValue(b, ['name', '品項名稱', '品項']) || "").toString().trim();

        const getSeriesNumber = (name) => {
            if (name.includes('20')) return 20;
            if (name.includes('30')) return 30;
            if (name.includes('40')) return 40;
            return 99;
        };

        const seriesA = getSeriesNumber(nameA);
        const seriesB = getSeriesNumber(nameB);

        if (seriesA !== seriesB) return seriesA - seriesB;
        return window.removeSKU(nameA).localeCompare(window.removeSKU(nameB), 'zh-TW');
    });

    // 重組為統一數組（用於後續渲染）
    const sortedInventory = [
        ...sortedAluminum,
        // 配件部分：以組為單位，每組包含該商品的所有系列
        ...Array.from(accessoryGroups.entries()).sort((a, b) => {
            return a[0].localeCompare(b[0], 'zh-TW');
        })
    ];

    // 追蹤當前系列和類型，用於插入分隔標題
    let lastSeries = null;
    let lastType = null;

    sortedInventory.forEach(item => {
        // 判斷是鋁材還是配件組
        const isAccessoryGroup = Array.isArray(item); // accessoryGroups的entry是[baseName, items[]]

        if (isAccessoryGroup) {
            // === 配件組渲染（新UI：大卡片+小卡片） ===
            const [baseName, seriesItems] = item;

            // 過濾當前分類
            const currentCategory = window.currentInventoryCategory || 'aluminum';
            if (currentCategory === 'aluminum') return; // 鋁材頁面不顯示配件

            // 插入配件分隔標題（只在第一個配件組時）
            if (lastType !== 'accessory') {
                html += `
                <div class="inventory-section-header" style="grid-column: 1 / -1; margin: 30px 0 20px; padding: 18px 25px; background: linear-gradient(135deg, #f0fdfa 0%, #e0f2fe 100%); border-left: 6px solid #0891b2; border-radius: 12px; box-shadow: 0 2px 8px rgba(8,145,178,0.1);">
                    <h2 style="margin: 0; color: #0e7490; font-size: 1.4rem; font-weight: 700; display: flex; align-items: center;">
                        <i class="fas fa-cubes" style="margin-right: 12px; color: #06b6d4; font-size: 1.3rem;"></i>配件總覽
                    </h2>
                </div>`;
                lastType = 'accessory';
            }


            // 渲染配件組：大標題卡片（兩個一排）
            html += `
            <div style="grid-column: 1 / -1; margin-bottom: 25px;">
                <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 14px 20px; border-radius: 10px; border-left: 4px solid #64748b; box-shadow: 0 2px 6px rgba(0,0,0,0.06);">
                    <h3 style="margin: 0; color: #475569; font-size: 1.2rem; font-weight: 700; display: flex; align-items: center;">
                        <i class="fas fa-box-open" style="margin-right: 8px; color: #94a3b8; font-size: 1.1rem;"></i>${baseName}
                    </h3>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px;">`;

            // 排序系列：20 → 30 → 40
            const sortedSeries = seriesItems.sort((a, b) => {
                const nameA = (findValue(a, ['name', '品項名稱']) || "").toString();
                const nameB = (findValue(b, ['name', '品項名稱']) || "").toString();
                const getS = (n) => {
                    const m = n.match(/^(20|30|40)-/);
                    return m ? parseInt(m[1]) : 99;
                };
                return getS(nameA) - getS(nameB);
            });

            // 渲染每個系列的小卡片
            sortedSeries.forEach(seriesItem => {
                const name = (findValue(seriesItem, ['name', '品項名稱']) || "").toString().trim();
                const rawStock = parseNum(findValue(seriesItem, ['qty', 'stock', '庫存數量', '數量']));

                // 提取系列
                const match = name.match(/^(20|30|40)-/);
                const series = match ? match[1] : '';

                // 【新增】提取規格（M4/M6/M8 或 3mm/5mm/6mm）
                let spec = '';
                const baseName = window.removeSKU(name).replace(/^(20|30|40|80)-/, '').trim();
                const mMatch = baseName.match(/^(M\d+)/);  // M4, M6, M8
                const mmMatch = baseName.match(/^(\d+mm)/); // 3mm, 5mm, 6mm

                if (mMatch) {
                    spec = mMatch[1];  // M4, M6, M8
                } else if (mmMatch) {
                    spec = mmMatch[1]; // 3mm, 5mm, 6mm
                }

                // 【新增】提取 SKU 編碼（例如 [L-001]）
                let skuCode = '';
                const skuMatch = name.match(/\[([^\]]+)\]/); // 匹配 [任意內容]
                if (skuMatch) {
                    skuCode = skuMatch[1]; // 提取括號內的內容
                }

                // 【修改】以當前庫存為上限基準
                const stockLimit = rawStock; // 當前數量 = 100%

                // 計算百分比
                const percentage = Math.min(Math.round((rawStock / stockLimit) * 100), 100);

                // 使用灰色進度條
                const statusColor = '#64748b'; // 統一灰色

                const seriesColors = {
                    '20': { bg: '#ffffff', border: '#3b82f6', text: '#3b82f6' },
                    '30': { bg: '#ffffff', border: '#f97316', text: '#f97316' },
                    '40': { bg: '#ffffff', border: '#22c55e', text: '#22c55e' }
                };
                const colors = seriesColors[series] || seriesColors['20'];

                // SVG 環形進度條參數
                const radius = 35;
                const circumference = 2 * Math.PI * radius;
                html += `
                    <div style="background: ${colors.bg}; padding: 20px 15px; border-radius: 10px; border: 2px solid #cbd5e1; text-align: center; box-shadow: 0 3px 8px rgba(0,0,0,0.1); transition: transform 0.2s ease, box-shadow 0.2s ease;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 3px 8px rgba(0,0,0,0.1)';">
                        <div style="font-size: 0.9rem; color: ${colors.text}; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.5px;">${series} 系列</div>
                        ${skuCode ? `<div style="font-size: 0.7rem; color: ${colors.text}; font-weight: 500; margin-bottom: 6px; opacity: 0.8;">[${skuCode}]</div>` : ''}
                        ${spec ? `<div style="font-size: 0.8rem; color: #64748b; font-weight: 600; opacity: 0.7; margin-bottom: 10px; padding: 2px 8px; background: rgba(100,116,139,0.1); border-radius: 4px; display: inline-block;">${spec}</div>` : '<div style="height: 10px;"></div>'}
                        
                        <!-- 庫存數量 -->
                        <div style="font-size: 1.8rem; font-weight: 900; color: ${colors.text}; line-height: 1; margin: 10px 0;">${rawStock}</div>
                        <div style="font-size: 0.65rem; color: #64748b; opacity: 0.7; margin-bottom: 10px;">上限: ${stockLimit}</div>
                        
                        <!-- 橫向進度條 -->
                        <div style="width: 100%; background: #e2e8f0; border-radius: 10px; height: 8px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                            <div style="width: ${percentage}%; background: ${colors.border}; height: 100%; border-radius: 10px; transition: width 0.5s ease;"></div>
                        </div>
                        <div style="font-size: 0.65rem; color: #64748b; margin-top: 6px;">${percentage}%</div>
                    </div>`;
            });

            html += `</div></div>`; // 關閉小卡片grid和外層div

        } else {
            // === 鋁材渲染（原邏輯） ===
            const name = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();

            if (!name || name === '') return;

            const rawStock = parseNum(findValue(item, ['qty', 'stock', '庫存數量', '數量', '庫存']));
            const offcutsStr = (findValue(item, ['offcuts', '餘料', '備註']) || "").toString();

            const isActuallyAluminum = ALUMINUM_ALLOW_LIST.some(model => name.includes(model));
            const currentCategory = window.currentInventoryCategory || 'aluminum';

            // 分類過濾
            if (currentCategory === 'aluminum' && !isActuallyAluminum) return;
            if (currentCategory === 'accessory' && isActuallyAluminum) return;

            if (!isActuallyAluminum) {
                const isBackendInventoryRow = name.match(/^(20|30|40)-/);
                if (!isBackendInventoryRow) return;
            }

            // 判定系列
            const currentSeries = (() => {
                if (isActuallyAluminum) {
                    if (name.includes('20')) return 20;
                    if (name.includes('30')) return 30;
                    if (name.includes('40')) return 40;
                } else {
                    const match = name.match(/^(20|30|40)-/);
                    if (match) return parseInt(match[1]);
                }
                return null;
            })();

            const currentType = isActuallyAluminum ? 'aluminum' : 'accessory';

            // 插入分隔標題
            if (currentSeries && (currentSeries !== lastSeries || currentType !== lastType)) {
                const typeLabel = isActuallyAluminum ? '鋁材' : '配件';
                const seriesColors = {
                    20: '#2980b9',
                    30: '#d35400',
                    40: '#27ae60'
                };
                const color = seriesColors[currentSeries] || '#666';

                html += `
            <div style="grid-column: 1 / -1; margin: 20px 0 10px; padding: 10px 15px; background: linear-gradient(135deg, ${color}15, ${color}05); border-left: 4px solid ${color}; border-radius: 6px;">
                <h3 style="margin: 0; color: ${color}; font-size: 1.2rem; font-weight: 600;">
                    <i class="fas fa-layer-group"></i> ${currentSeries} 系列 ${typeLabel}
                </h3>
            </div>`;

                lastSeries = currentSeries;
                lastType = currentType;
            }

            // Determine Series for Color
            let seriesClass = "";
            if (isActuallyAluminum) {
                // For aluminum, use name-based detection
                if (name.includes('20')) seriesClass = "series-20";
                else if (name.includes('30')) seriesClass = "series-30";
                else if (name.includes('40')) seriesClass = "series-40";
            } else {
                // 【修正】For accessories, use PREFIX-based detection
                // 根據前綴判定系列（與過濾邏輯一致）
                if (name.startsWith('20-')) seriesClass = "series-20";
                else if (name.startsWith('30-')) seriesClass = "series-30";
                else if (name.startsWith('40-')) seriesClass = "series-40";
                // 不再使用 accessoryIndex，已棄用
            }

            // Determine Type (Light/Heavy) for Badges
            let typeBadge = "";
            if (name.includes('重型')) typeBadge = '<span class="badge-heavy">重型</span>';
            else if (name.includes('輕型')) typeBadge = '<span class="badge-light">輕型</span>';

            if (isActuallyAluminum) {
                // === ALUMINUM CARD TEMPLATE ===
                let stockInBars = Math.floor(rawStock / 600);
                let cmDetail = `<div style="font-size:0.75rem; color:#856404; opacity:0.8;">(共 ${rawStock} cm)</div>`;

                const offcuts = offcutsStr ? offcutsStr.split(/[,，、 ]+/).reduce((acc, s) => {
                    let num = parseFloat(s.trim());
                    // Fix for concatenated strings (e.g., 199199199)
                    if (num > 650) { // If larger than any reasonable stock
                        // Try to split by common lengths (e.g. 199, 199.5)
                        let str = s.trim();
                        while (str.length > 0) {
                            // Try to find a logical split (3-5 chars)
                            // This is a heuristic fallback
                            let chunk = str.substring(0, str.indexOf('.') + 2); // try to find decimal
                            if (!chunk || chunk.length < 3) chunk = str.substring(0, 3);

                            let val = parseFloat(chunk);
                            if (!isNaN(val)) acc.push(val);
                            str = str.substring(chunk.length);
                            if (acc.length > 20) break; // emergency break
                        }
                    } else if (num > 0) {
                        acc.push(num);
                    }
                    return acc;
                }, []) : [];

                // Determine color theme based on series
                let barGradient = "linear-gradient(90deg, #f39c12, #e67e22)"; // Default orange
                let bgGradient = "linear-gradient(135deg, #fffcf5 0%, #fff8f0 100%)";
                let borderColor = "#ffeeba";
                let labelColor = "#856404";
                let numberColor = "#d35400";

                if (seriesClass === "series-20") {
                    barGradient = "linear-gradient(90deg, #3b82f6, #2563eb)";
                    bgGradient = "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)";
                    borderColor = "#93c5fd";
                    labelColor = "#1d4ed8";
                    numberColor = "#1e3a8a";
                } else if (seriesClass === "series-30") {
                    barGradient = "linear-gradient(90deg, #f97316, #ea580c)";
                    bgGradient = "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)";
                    borderColor = "#fdba74";
                    labelColor = "#c2410c";
                    numberColor = "#9a3412";
                } else if (seriesClass === "series-40") {
                    barGradient = "linear-gradient(90deg, #22c55e, #16a34a)";
                    bgGradient = "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)";
                    borderColor = "#86efac";
                    labelColor = "#15803d";
                    numberColor = "#14532d";
                }

                let offcutsHtml = '';
                offcuts.forEach((len, idx) => {
                    let widthPct = Math.min((len / 600) * 100, 100);
                    offcutsHtml += `
                    <div style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:2px;">
                                <span style="font-weight:600; color:${labelColor};">${len} <span style="font-size:0.7rem; opacity:0.7;">cm</span></span>
                            </div>
                            <div style="height:6px; background:#f1f5f9; border-radius:3px; overflow:hidden;">
                                <div style="height:100%; width:${widthPct}%; background:${barGradient}; border-radius:3px;"></div>
                            </div>
                        </div>
                        <button onclick="deleteOffcut('${name}', ${idx})" title="刪除此餘料" style="background:none; border:none; color:#cbd5e1; cursor:pointer; padding:4px;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#cbd5e1'">
                            <i class="fas fa-times-circle"></i>
                        </button>
                    </div>`;
                });

                // --- Waste Display Logic ---
                let totalWaste = 0;
                let wasteHtml = '';
                // Robustly find 'waste' column (G)
                let wasteRaw = findValue(item, ['waste', '廢料', 'G']);
                if (wasteRaw) totalWaste = parseFloat(wasteRaw) || 0;

                if (totalWaste > 0) {
                    wasteHtml = `
                <div class="waste-section" style="margin-top:10px; padding:10px; background:#f8f9fa; border:1px dashed #94a3b8; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.85rem; color:#64748b; font-weight:bold;"><i class="fas fa-trash-alt"></i> 累積廢料</span>
                        <div style="font-size:0.7rem; color:#94a3b8; margin-top:2px;">(已無法再利用的短料總和)</div>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:1.1rem; font-weight:bold; color:#64748b;">${totalWaste.toFixed(1)} <span style="font-size:0.7rem;">cm</span></span>
                        <button onclick="clearWaste('${name}')" style="margin-left:8px; font-size:0.75rem; color:#fff; background:#94a3b8; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; box-shadow:0 2px 4px rgba(148,163,184,0.2);" onmouseover="this.style.background='#64748b'" onmouseout="this.style.background='#94a3b8'">
                            <i class="fas fa-eraser"></i> 歸零
                        </button>
                    </div>
                </div>`;
                }

                // 解析 SKU 編碼（如果有）
                let sku = window.parseSKU(name);
                let displayName = window.removeSKU(name);
                let skuBadge = sku ? `<span style="display:inline-block; margin-left:8px; font-size:0.7rem; font-weight:600; color:#64748b; background:rgba(148,163,184,0.15); padding:3px 8px; border-radius:4px; border:1px solid rgba(148,163,184,0.3);">${sku}</span>` : '';

                html += `
            <div class="inventory-card" style="border-top: 4px solid ${labelColor}; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
                <div class="card-header" style="background: ${bgGradient}; border-bottom: 1px solid ${borderColor}">
                    <div class="card-title" style="color: ${labelColor}">
                        ${displayName} ${typeBadge} ${skuBadge}
                    </div>
                    <div class="card-stock-main">
                        <span style="font-size: 1.25rem; font-weight: 700; color: ${labelColor}">${stockInBars}</span>
                        <span style="font-size: 0.8rem; font-weight: 500; color: ${labelColor}; opacity: 0.8; margin-left: 2px">支</span>
                    </div>
                </div>

                <div class="card-body">
                    <!-- Standard Stock Info -->
                    <div class="stock-showcase" style="margin-bottom:18px; background:${bgGradient}; padding:12px; border-radius:10px; border:1px solid ${borderColor}; box-shadow:0 2px 4px rgba(0,0,0,0.02);">
                        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:8px;">
                            <div style="font-size:0.85rem; color:${labelColor}; font-weight:bold;"><i class="fas fa-box-open"></i> 標準全長料 (600cm)</div>
                            <div style="font-size:0.75rem; color:${labelColor}; opacity:0.8;">(共 ${rawStock} cm)</div>
                        </div>
                        <div class="stock-bar-container">
                            <div class="stock-bar" style="width: ${Math.min((stockInBars / 200) * 100, 100)}%;">w: 100%</div>
                        </div>
                        <div style="text-align:right; margin-top:4px;">
                            <span style="color:${numberColor}; font-weight:700; font-size:0.9rem;">${stockInBars}</span>
                            <span style="color:#64748b; font-size:0.75rem;">支</span>
                        </div>
                    </div>

                    <!-- Offcuts Visuals -->
                    <div class="offcuts-section" style="margin-top:15px; border-top:1px solid #f1f5f9; padding-top:15px;">
                        <div style="display:flex; align-items:center; margin-bottom:10px;">
                            <i class="fas fa-ruler-combined" style="color:#64748b; font-size:0.8rem; margin-right:6px;"></i>
                            <span style="font-size:0.8rem; color:#64748b; font-weight: 500;">餘料視覺分佈 (${offcuts.length} 支) :</span>
                        </div>
                        
                        <div class="offcuts-list-scroll">
                            ${offcuts.length > 0 ? offcutsHtml : '<div class="no-offcuts">暫無餘料</div>'}
                        </div>
                    </div>
                    
                    ${wasteHtml}
                </div>
            </div>`;

            } else {
                // === ACCESSORY CARD TEMPLATE (Simple) ===
                // Determine color theme based on series
                let bgGradient = "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)";
                let borderColor = "#bae6fd";
                let iconColor = "#0284c7";
                let textColor = "#0369a1";
                let numberColor = "#0c4a6e";

                if (seriesClass === "series-20") {
                    bgGradient = "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)";
                    borderColor = "#93c5fd";
                    iconColor = "#2563eb";
                    textColor = "#1d4ed8";
                    numberColor = "#1e3a8a";
                } else if (seriesClass === "series-30") {
                    bgGradient = "linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)";
                    borderColor = "#fdba74";
                    iconColor = "#ea580c";
                    textColor = "#c2410c";
                    numberColor = "#9a3412";
                } else if (seriesClass === "series-40") {
                    bgGradient = "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)";
                    borderColor = "#86efac";
                    iconColor = "#16a34a";
                    textColor = "#15803d";
                    numberColor = "#14532d";
                }


                // 解析 SKU 編碼（配件）
                let skuAcc = window.parseSKU(name);
                let displayNameAcc = window.removeSKU(name);
                let skuBadgeAcc = skuAcc ? `<span style="display:inline-block; margin-left:8px; font-size:0.7rem; font-weight:600; color:#64748b; background:rgba(148,163,184,0.15); padding:3px 8px; border-radius:4px; border:1px solid rgba(148,163,184,0.3);">${skuAcc}</span>` : '';

                html += `
            <div class="inventory-card" style="border-top: 4px solid ${textColor}; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <div class="card-header" style="background: ${bgGradient}; border-bottom: 1px solid ${borderColor}">
                    <div class="card-title" style="color: ${textColor}">
                        ${displayNameAcc} ${skuBadgeAcc}
                    </div>
                </div>
                <div class="card-body" style="display:flex; justify-content:center; align-items:center; flex-direction:column; padding:20px;">
                     <div style="width:60px; height:60px; background:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 10px rgba(0,0,0,0.05); margin-bottom:10px;">
                        <i class="fas fa-cubes" style="font-size:1.8rem; color:${iconColor};"></i>
                     </div>
                     <div style="text-align:center;">
                        <div style="font-size:0.75rem; color:${textColor}; font-weight:600;">庫存數量</div>
                        <div style="font-size:1.5rem; font-weight:900; color:${numberColor};">${rawStock}</div>
                        <div style="font-size:0.9rem; color:${textColor}; font-weight:600;">個/組</div>
                     </div>
                </div>
            </div > `;
            }
        }  // 結束else (鋁材渲染)
    });  // 結束forEach

    html += '</div>';
    container.innerHTML = html;
}

window.deleteOffcut = async function (model, index) {
    if (!confirm(`確定要刪除 【${model}】 的這根餘料嗎？\n(此操作將同步更新 Excel)`)) return;

    try {
        const res = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "deleteOffcut",
                model: model,
                index: index
            })
        });
        const json = await res.json();
        if (json.status === 'success') {
            fetchInventoryData(); // Refresh
        } else {
            alert("刪除失敗: " + json.message);
        }
    } catch (e) {
        alert("刪除出錯: " + e.message);
    }
};

window.recordOffcutsToInventory = async function () {
    const resultsArea = document.getElementById('opt-results-area');
    if (!resultsArea) return;

    // 1. Gather Data from UI Results
    const leftovers = resultsArea.querySelectorAll('.cut-remain.leftover');
    const newBarRows = resultsArea.querySelectorAll('.bin-header[title*="新料"]'); // Assuming bin-header has this info

    if (!confirm(`確定要紀錄此切割計畫結果嗎？\n\n系統將會：\n1.扣除使用的標準長料\n2.紀錄產生的 ${leftovers.length} 支餘料`)) return;

    let inventoryUpdate = {}; // { model: { usedStock: N, newOffcuts: [...] } }
    const elements = resultsArea.childNodes;
    let currentModel = "";

    elements.forEach(node => {
        if (node.tagName === 'H3') {
            const mMatch = node.innerText.match(/【(.*?)】/);
            if (mMatch) currentModel = mMatch[1];
        }
        if (node.classList && node.classList.contains('cutting-visuals') && currentModel) {
            if (!inventoryUpdate[currentModel]) inventoryUpdate[currentModel] = { usedStock: 0, newOffcuts: [] };

            // Count New Bars used
            const rows = node.querySelectorAll('.cutting-row');
            rows.forEach(row => {
                const header = row.querySelector('.bin-header');
                if (header && (header.innerText.includes('新料') || header.title.includes('新料'))) {
                    inventoryUpdate[currentModel].usedStock++;
                }
            });

            // Gather New Offcuts generated
            const modelOffcuts = node.querySelectorAll('.cut-remain.leftover');
            modelOffcuts.forEach(el => {
                const lenMatch = el.getAttribute('title').match(/剩餘 ([\d.]+)cm/);
                if (lenMatch) {
                    inventoryUpdate[currentModel].newOffcuts.push(parseFloat(lenMatch[1]));
                }
            });
        }
    });

    // 2. Send to Backend
    try {
        const res = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "recordCuttingResult",
                updateData: inventoryUpdate
            })
        });
        const json = await res.json();
        if (json.status === 'success') {
            alert("✅ 庫存已更新！\n(使用的標準料已扣除，新餘料已入庫)");
            fetchInventoryData(); // Refresh Inventory Tab
        } else {
            alert("更新失敗: " + json.message);
        }
    } catch (e) {
        alert("連線錯誤: " + e.message);
    }
};







// === Smart Cutting Plan Recording (with Offcut/Waste Tracking) ===
// Fixed Version: Uses Unicode Escapes to avoid encoding corruption
// === Missing Cutting Logic Restored ===

window.generateConsolidatedCuttingList = function () {
    const list = ordersData.filter(o => o.status === 'cutting');
    if (list.length === 0) { alert("目前沒有「切料中」的訂單"); return; }
    showMergeCuttingModal(list);
};

window.showMergeCuttingModal = function (list) {
    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');
    if (!modal || !body) return;

    let html = `<div style="padding:20px;">
        <h2 style="color:#2c3e50; text-align:center;">合併切料運算</h2>
        <p style="text-align:center; color:#7f8c8d;">共 ${list.length} 張訂單待切料</p>
        <div style="max-height:150px; overflow-y:auto; background:#f9f9f9; padding:10px; margin-bottom:20px; border:1px solid #eee;">`;

    list.forEach(o => {
        html += `<div style="font-size:0.9rem; border-bottom:1px dashed #eee; padding:5px;">
            <span style="font-weight:bold;">${o.name}</span> (${o.phone}) - ${new Date(o.timestamp).toLocaleDateString()}
        </div>`;
    });

    html += `</div>
        <div style="text-align:center;">
            <button class="btn-primary" onclick="runCuttingOptimization()" style="font-size:1.2rem; padding:10px 30px;">開始計算最佳化切割</button>
        </div>
        <div id="opt-results-area" style="margin-top:20px;"></div>
    </div>`;

    body.innerHTML = html;
    modal.style.display = 'flex';
};

window.runCuttingOptimization = async function () {
    const area = document.getElementById('opt-results-area');
    if (!area) return;
    area.innerHTML = `<div style="text-align:center; padding:20px;"><i class="fas fa-spinner fa-spin"></i> 正在同步庫存並計算排程...</div>`;

    // 0. Auto-Fetch Inventory if missing
    if (!window.allInventory || window.allInventory.length === 0) {
        try {
            console.log("Auto-fetching inventory for calculation...");
            const res = await fetch(ADMIN_API_URL + "?action=getInventory&t=" + new Date().getTime());
            const json = await res.json();
            if (Array.isArray(json)) {
                window.allInventory = json;
            } else if (json && Array.isArray(json.inventory)) {
                window.allInventory = json.inventory;
            } else if (json && json.data) {
                window.allInventory = json.data;
            }
            console.log("Inventory Fetched:", window.allInventory ? window.allInventory.length : 0);
        } catch (e) {
            area.innerHTML = `<div style="color:red; text-align:center; padding:20px;">無法自動讀取庫存，請檢查網路連線。<br>${e.message}</div>`;
            return;
        }
    }

    if (!window.allInventory || window.allInventory.length === 0) {
        area.innerHTML = `<div style="color:red; text-align:center; padding:20px;">庫存資料為空，無法計算餘料。</div>`;
        return;
    }

    // 1. Parse all items
    let allItems = [];
    ordersData.filter(o => o.status === 'cutting').forEach(o => {
        let details = o.details || "";
        let lines = details.split(/\\n|\n/).filter(l => l.trim().length > 0);
        lines.forEach(line => {
            if (!(line.includes('鋁材') || line.includes('鋁擠型'))) return;

            // Extract Name (Model)
            let nameMatch = line.match(/(.*?)(?:\( x \d+ \))/);
            if (!nameMatch) return;
            let rawName = nameMatch[1].trim();
            let model = rawName.replace(/【.*?】/g, '').replace(/\(L=\d+cm\)/g, '').trim();

            // Extract Qty
            let qty = 1;
            let qMatch = line.match(/\( x (\d+) \)/);
            if (qMatch) qty = parseInt(qMatch[1]);

            // Extract Length (支援小數)
            let len = 0;
            let lMatch = line.match(/\(L=([\d.]+)cm\)/);
            if (lMatch) len = parseFloat(lMatch[1]);

            if (len > 0) {
                allItems.push({ model: model, length: len, qty: qty, orderId: o.timestamp });
            }
        });
    });

    // 2. Group by Model
    let grouped = {};
    allItems.forEach(item => {
        if (!grouped[item.model]) grouped[item.model] = [];
        for (let i = 0; i < item.qty; i++) grouped[item.model].push(item.length);
    });

    // 3. Bin Packing with Offcut Priority & Kerf Loss
    const KERF = 0.5; // Saw blade thickness
    let visualsHtml = "";

    for (let model in grouped) {
        let needs = grouped[model];
        needs.sort((a, b) => b - a); // Descending

        // Find Inventory Item (Unified Key Match)
        const standardizedKey = window.getInventoryKey(model, 99);
        let invItem = window.allInventory.find(i => {
            let invName = (i.name || i.品項名稱 || "").toString();
            return invName === standardizedKey || invName.includes(standardizedKey);
        });

        // Parse Available Offcuts
        let availableOffcuts = [];
        let dataWarning = "";

        if (invItem) {
            let offRaw = invItem.offcuts || invItem.餘料;
            // Handle Number type from Google Sheet (e.g. 49 or 199199...)
            let offStr = (offRaw === undefined || offRaw === null) ? "" : String(offRaw);

            if (offStr) {
                // Split by common delimiters
                let candidates = offStr.split(/[,，、 ]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);

                candidates.forEach(len => {
                    if (len > 1000) {
                        dataWarning = `<div style="color:red; font-size:0.8rem; background:#fee; padding:5px; margin-bottom:5px; border-radius:4px;">
        <i class="fas fa-exclamation-triangle"></i> 警告：餘料數據異常(${len})。<br>請檢查 Google Sheet 儲存格格式是否誤設為「數字」。請改為「純文字」。
        </div>`;
                    } else {
                        availableOffcuts.push(len);
                    }
                });

                availableOffcuts.sort((a, b) => a - b); // Ascending (Best Fit)
            }
        }

        let offcutBins = availableOffcuts.map(len => ({
            type: 'offcut',
            sourceLen: len,
            capacity: len,
            remain: len,
            cuts: []
        }));

        let newBarBins = [];

        needs.forEach(len => {
            let placed = false;
            let neededSpace = len + KERF;

            // A. Try Available Offcuts (Best Fit)
            for (let bin of offcutBins) {
                // If remaining space allows cut (considering KERF)
                // Note: If remain is exactly len, we can take it (no kerf needed for edge).
                // Simplified Logic: If remain >= len + kerf OR (remain >= len AND abs(remain-len)<0.1)

                if (Math.abs(bin.remain - len) < 0.1) {
                    bin.cuts.push(len);
                    bin.remain = 0;
                    placed = true;
                    break;
                } else if (bin.remain >= neededSpace) {
                    bin.cuts.push(len);
                    bin.remain -= neededSpace;
                    placed = true;
                    break;
                }
            }

            if (!placed) {
                // B. Try Existing New Bars
                for (let bin of newBarBins) {
                    if (bin.remain >= neededSpace) {
                        bin.cuts.push(len);
                        bin.remain -= neededSpace;
                        placed = true;
                        break;
                    }
                }
            }

            if (!placed) {
                // C. Open New Bar (600cm)
                let bin = {
                    type: 'new',
                    capacity: 600,
                    remain: 600,
                    cuts: []
                };
                bin.cuts.push(len);
                bin.remain -= neededSpace;
                newBarBins.push(bin);
            }
        });

        // 判定系列颜色
        let seriesColor = '#2980b9'; // 默认蓝色 (20系列)
        if (model.includes('30')) seriesColor = '#d35400'; // 橙色
        else if (model.includes('40')) seriesColor = '#27ae60'; // 绿色
        else if (model.includes('80')) seriesColor = '#27ae60'; // 80也用绿色

        // 灰色系（余料/废料）
        const grayColors = {
            offcut: '#94a3b8',    // 淺灰色（餘料）
            waste: '#475569'      // 深灰色（廢料）
        };

        // Render
        visualsHtml += `<div class="cutting-model-section" style="page-break-inside: avoid; margin-bottom: 30px;">`;
        visualsHtml += `<h3 style="color:${seriesColor}; border-left:4px solid ${seriesColor}; padding-left:12px;">【${model}】</h3>`;
        if (dataWarning) visualsHtml += dataWarning;
        visualsHtml += `<div class="cutting-visuals" style="margin-bottom:20px;">`;

        // Render Used Offcuts
        let usedOffs = offcutBins.filter(b => b.cuts.length > 0);
        if (usedOffs.length > 0) {
            visualsHtml += `<div style="font-size:0.85rem; font-weight:bold; color:#64748b; margin:5px 0;">使用餘料(${usedOffs.length} 支):</div>`;
            usedOffs.forEach((bin, idx) => {
                let remain = bin.remain < 0 ? 0 : bin.remain; // clamp
                let widthPct = (bin.capacity / 600) * 100; // Relative to 600 for scale

                visualsHtml += `<div class="cut-row" style="display:flex; align-items:center; margin-bottom:5px; border:1px solid #94a3b8; border-left:3px solid #94a3b8; padding:5px; border-radius:4px; background:#f8f9fa;">`;
                visualsHtml += `<div class="bin-header" style="width:80px; font-weight:bold; color:#64748b;">餘料 ${bin.sourceLen}cm</div>`;
                visualsHtml += `<div style="flex:1; display:flex; height:30px; background:#eee; border-radius:4px; overflow:hidden; max-width:${widthPct}%">`;

                bin.cuts.forEach(c => {
                    let pct = (c / bin.capacity) * 100;
                    visualsHtml += `<div class="cut-segment" style="width:${pct}%; background:${seriesColor}; border-right:1px solid #fff; color:#fff; font-size:10px; display:flex; align-items:center; justify-content:center;" title="切割 ${c}cm">
        ${c}
                     </div>`;
                });
                if (remain > 0) {
                    let rPct = (remain / bin.capacity) * 100;
                    visualsHtml += `<div class="cut-remain leftover" style="width:${rPct}%; background:${grayColors.offcut}; opacity:0.7; font-size:10px; display:flex; align-items:center; justify-content:center; color:#fff;" title="剩餘 ${remain.toFixed(1)}cm (餘料)">
        ${remain.toFixed(1)}
                     </div>`;
                }
                visualsHtml += `</div></div>`;
            });
        }

        // Render New Bars
        if (newBarBins.length > 0) {
            visualsHtml += `<div style="font-size:0.85rem; font-weight:bold; color:${seriesColor}; margin:10px 0 5px 0;">使用新料(${newBarBins.length} 支):</div>`;
            newBarBins.forEach((bin, idx) => {
                let remain = bin.remain;
                let isRemCheck = remain >= 10;

                visualsHtml += `<div class="cut-row" style="display:flex; align-items:center; margin-bottom:5px; border:1px solid ${seriesColor}; border-left:3px solid ${seriesColor}; padding:5px; border-radius:4px; background:#fff;">`;
                visualsHtml += `<div class="bin-header" style="width:80px; font-weight:bold; color:${seriesColor};">新料 #${idx + 1}</div>`;

                visualsHtml += `<div style="flex:1; display:flex; height:30px; background:#eee; border-radius:4px; overflow:hidden;">`;

                bin.cuts.forEach(cutLen => {
                    let pct = (cutLen / 600) * 100;
                    visualsHtml += `<div class="cut-block" style="width:${pct}%; background:${seriesColor}; border-right:1px solid #fff; color:#fff; font-size:11px; display:flex; align-items:center; justify-content:center;" title="切割 ${cutLen}cm">
                        <span>${cutLen}</span>
                    </div>`;
                });

                if (remain > 0) {
                    let rPct = (remain / 600) * 100;
                    let color = isRemCheck ? grayColors.offcut : grayColors.waste;
                    let type = isRemCheck ? '余料' : '废料';
                    let cls = isRemCheck ? 'cut-remain leftover' : 'cut-remain waste';

                    visualsHtml += `<div class="${cls}" style="width:${rPct}%; background:${color}; color:#fff; font-size:10px; display:flex; align-items:center; justify-content:center; opacity:0.8;" title="剩余 ${remain.toFixed(1)}cm (${type})">
                        ${remain.toFixed(1)} cm
                    </div>`;
                }

                visualsHtml += `</div></div>`;
            });
        }

        visualsHtml += `</div>`;
        visualsHtml += `</div>`; // Close cutting-model-section
    }

    // Add Action Buttons (Print + Confirm)
    visualsHtml += `<div class="no-print" style="text-align:center; margin-top:30px; border-top:1px solid #eee; padding-top:20px; display:flex; gap:15px; justify-content:center; flex-wrap:wrap;">
        <button onclick="window.printCuttingList()" style="background:#3498db; color:white; padding:12px 24px; border:none; border-radius:6px; font-size:1.1rem; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            <i class="fas fa-print"></i> 列印切料表
        </button>
        <button class="btn-record-offcut" onclick="try{window.recordCuttingPlanToInventory()}catch(e){alert('Error: '+e.message)}" style="background:#e74c3c; color:white; padding:12px 24px; border:none; border-radius:6px; font-size:1.1rem; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            <i class="fas fa-save"></i> 確認切割計畫並更新庫存
        </button>
    </div>`;

    area.innerHTML = visualsHtml;
};

// 列印切料表函數
window.printCuttingList = function () {
    const resultsArea = document.getElementById('opt-results-area');
    if (!resultsArea) {
        alert('找不到切割計畫內容');
        return;
    }

    const printContent = resultsArea.innerHTML;
    const printWindow = window.open('', '_blank');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>切料表列印</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
            <style>
                * { 
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    color-adjust: exact !important;
                }
                body { 
                    font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif;
                    padding: 20px;
                    margin: 0;
                }
                h3 {
                    font-size: 1.5rem;
                    margin-top: 20px;
                    page-break-after: avoid;
                }
                .cutting-model-section {
                    page-break-before: always;
                    page-break-inside: avoid;
                }
                .cutting-model-section:first-child {
                    page-break-before: avoid;
                }
                .cut-row {
                    margin-bottom: 8px !important;
                }
                .no-print { display: none !important; }
                @media print {
                    body { padding: 0; }
                    .cutting-model-section {
                        page-break-before: always;
                        page-break-inside: avoid;
                    }
                    .cutting-model-section:first-child {
                        page-break-before: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <h1 style="text-align:center; margin-bottom:30px; border-bottom:2px solid #333; padding-bottom:15px;">
                <i class="fas fa-cut"></i> 合併切料表
            </h1>
            ${printContent}
            <script>
                window.onload = function() {
                    window.print();
                };
            <\/script>
        </body>
        </html>
    `);

    printWindow.document.close();
};


window.recordCuttingPlanToInventory = async function () {
    // Phase 1: Setup
    const resultsArea = document.getElementById('opt-results-area');
    if (!resultsArea) {
        alert("Error: opt-results-area not found");
        return;
    }

    let cuttingPlans = {};
    const headers = resultsArea.querySelectorAll('h3');
    console.log("Found headers:", headers.length);

    headers.forEach(header => {
        // match: 【(.*?)】 OR just text
        let rawHeader = header.innerText.trim();
        console.log("Checking header:", rawHeader);

        // Remove brackets to get clean name
        let modelName = rawHeader.replace(/【|】/g, '').trim();

        if (!modelName) {
            console.log("No model name found in header:", rawHeader);
            return;
        }

        // Standardize Key for Backend
        modelName = window.getInventoryKey(modelName, 99);

        let visualsDiv = header.nextElementSibling;
        while (visualsDiv && !visualsDiv.classList.contains('cutting-visuals')) {
            visualsDiv = visualsDiv.nextElementSibling;
        }
        if (!visualsDiv) return;

        cuttingPlans[modelName] = {
            deductStandardCM: 0,
            removeOffcuts: [],
            addOffcuts: [],
            addWasteCM: 0
        };

        const cutRows = visualsDiv.querySelectorAll('.cut-row');
        cutRows.forEach(row => {
            const binHeader = row.querySelector('.bin-header');
            if (!binHeader) return;
            const headerText = binHeader.textContent.trim();

            // Case A: New Bar (新料)
            if (headerText.includes('新料')) {
                // Determine how much to deduct.
                // Assuming fetching a "New Bar" consumes one standard stock unit (600cm).
                // The remainder is tracked as offcut/waste.
                cuttingPlans[modelName].deductStandardCM += 600;
            }
            // Case B: Offcut (餘料)
            else if (headerText.includes('餘料')) {
                // Extract 123cm or 123.5cm
                const match = headerText.match(/(\d+(\.\d+)?)cm/);
                if (match) {
                    cuttingPlans[modelName].removeOffcuts.push(parseFloat(match[1]));
                }
            }

            // Check Remainder (for all rows)
            const remainDiv = row.querySelector('.cut-remain');
            if (remainDiv) {
                // Title format: "剩餘 123.5cm (餘料)"
                const title = remainDiv.getAttribute('title') || "";
                const remainMatch = title.match(/[\d.]+/);

                if (remainMatch) {
                    const remainLen = parseFloat(remainMatch[0]);
                    // Logic: >= 10cm is useful Offcut, else Waste
                    if (remainLen >= 10) {
                        cuttingPlans[modelName].addOffcuts.push(remainLen);
                    } else if (remainLen > 0) {
                        cuttingPlans[modelName].addWasteCM += remainLen;
                    }
                }
            }
        });
    });

    // Build Confirm Message
    let confirmMsg = '確定要記錄此切割計畫嗎？\n\n'.replace(/確定要記錄此切割計畫嗎？/, '\u78ba\u5b9a\u8981\u8a18\u9304\u6b64\u5207\u5272\u8a08\u756b\u55ce\uff1f');
    let hasData = false;

    for (let model in cuttingPlans) {
        const plan = cuttingPlans[model];
        // Only show if there's activity
        if (plan.deductStandardCM > 0 || plan.removeOffcuts.length > 0 || plan.addOffcuts.length > 0) {
            hasData = true;
            confirmMsg += `【${model}】\n`;
            if (plan.deductStandardCM > 0) confirmMsg += `  - 扣除標準料: ${plan.deductStandardCM} cm(約 ${Math.round(plan.deductStandardCM / 600)} 支) \n`;
            if (plan.removeOffcuts.length > 0) confirmMsg += `  - 使用餘料: ${plan.removeOffcuts.join(', ')} (共 ${plan.removeOffcuts.length} 支) \n`;
            if (plan.addOffcuts.length > 0) confirmMsg += `  - 產生餘料: ${plan.addOffcuts.length} 支\n`;
            if (plan.addWasteCM > 0) confirmMsg += `  - 產生廢料: ${plan.addWasteCM.toFixed(1)} cm\n`;
            confirmMsg += '\n';
        }
    }

    if (!hasData) {
        alert("沒有檢測到任何有效的切割計畫資料。請確認是否已執行運算。");
        return;
    }

    if (!confirm(confirmMsg)) return;

    // Update Inventory via API
    try {
        const updates = [];
        for (let modelName in cuttingPlans) {
            const plan = cuttingPlans[modelName];
            // Skip empty plans
            if (plan.deductStandardCM === 0 && plan.removeOffcuts.length === 0 && plan.addOffcuts.length === 0 && plan.addWasteCM === 0) continue;

            updates.push(fetch(ADMIN_API_URL, {
                method: "POST",
                body: JSON.stringify({
                    action: "updateInventoryWithCuttingPlan",
                    modelName: modelName,
                    deductStandardCM: plan.deductStandardCM,
                    removeOffcuts: plan.removeOffcuts, // Passed as Array
                    addOffcuts: plan.addOffcuts,       // Passed as Array
                    addWasteCM: plan.addWasteCM
                })
            }).then(r => r.json()).then(json => {
                if (json.status !== 'success') {
                    throw new Error(`${modelName}: ${json.message} `);
                }
                return modelName;
            }));
        }

        await Promise.all(updates);

        alert("✅ 庫存與餘料已成功更新！");

        // Auto-Advance Logic: Move all 'cutting' orders to 'inspection'
        // Auto-Advance Logic: Move all 'cutting' orders to 'inspection'
        if (typeof ordersData !== 'undefined' && ordersData) {
            let advancedCount = 0;
            // Load current status map
            let savedStatuses = JSON.parse(localStorage.getItem('order_statuses') || '{}');

            ordersData.filter(o => o.status === 'cutting').forEach(o => {
                // 1. Mark as deducted (Inventory Safety)
                setProfileDeducted(o.timestamp);

                // 2. Advance Status
                o.status = 'inspection';

                // 3. PERSIST to LocalStorage (Use explicit String key)
                savedStatuses[String(o.timestamp)] = 'inspection';

                advancedCount++;
            });

            if (advancedCount > 0) {
                localStorage.setItem('order_statuses', JSON.stringify(savedStatuses));

                // Refresh Board immediately
                if (window.applyFilter) window.applyFilter();

                // FORCE Refresh from source to ensure persistence sticks
                setTimeout(() => {
                    if (window.fetchOrders) window.fetchOrders();
                }, 500);

                alert(`✅ 庫存已更新！\n\n共 ${advancedCount} 筆訂單已自動切換至「鋁料品檢」區。`);
            } else {
                // Determine WHY 0 were found
                let allStatuses = ordersData.map(o => o.status).join(', ');
                alert(`✅ 庫存已更新！\n\n(注意：沒有偵測到「切料單」狀態的訂單，因此未執行自動移動。) \n目前訂單狀態: ${allStatuses} `);
            }
        }

        // Refetch to update UI
        if (window.fetchInventoryData) fetchInventoryData();

        // Close Modal
        if (window.closeModal) closeModal();

    } catch (e) {
        alert("更新失敗: " + e.message);
        console.error(e);
    }
};

// === Clear Waste Function ===
window.clearWaste = async function (modelName) {
    if (!confirm(`\u78ba\u5b9a\u8981\u6e05\u9664 \u3010${modelName} \u3011 \u7684\u5ecd\u6599\u7d2f\u7a4d\u8a18\u9304\u55ce\uff1f\n\n\u6b64\u64cd\u4f5c\u5c07\uff1a\n - \u91cd\u7f6e\u5ecd\u6599\u7d2f\u7a4d\u70ba 0\n - \u540c\u6b65\u66f4\u65b0 Excel\n\n\u26a0\ufe0f \u6b64\u64cd\u4f5c\u7121\u6cd5\u5fa9\u539f\uff01`)) return;

    try {
        const res = await fetch(ADMIN_API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "clearWasteRecord",
                modelName: modelName
            })
        });
        const json = await res.json();
        if (json.status === 'success') {
            alert("\u2705 \u5ecd\u6599\u8a18\u9304\u5df2\u6e05\u9664\uff01");
            fetchInventoryData();
        } else {
            alert("\u6e05\u9664\u5931\u6557: " + json.message);
        }
    } catch (e) {
        alert("\u6e05\u9664\u51fa\u932f: " + e.message);
    }
};


// Explicitly expose to window
window.recordCuttingPlanToInventory = recordCuttingPlanToInventory;
console.log("recordCuttingPlanToInventory exposed to window");
