// Link to the same API
const ADMIN_API_URL = "https://script.google.com/macros/s/AKfycbx2mqPe1ilOWDQ45JYDGJ2KaAUZ9dyH0fT-NwIDOdqUNmz1Dn3-tsL70urJT2cYYI5Q/exec";

// === 版本印記（部署後按 F12 看 Console 確認是否生效）===
console.log("%c[ADMIN] build 20260617h", "background:#222B34;color:#BEBEBE;padding:2px 8px;border-radius:3px;font-weight:bold;");

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

// [持久化修正] 把狀態同時存 localStorage + POST 後端，避免「改了卻沒存」→ 重整跳回 / 別台沒同步
window.persistOrderStatus = function (orderId, status, target) {
    try {
        let saved = JSON.parse(localStorage.getItem('order_statuses') || '{}');
        saved[orderId] = status;
        localStorage.setItem('order_statuses', JSON.stringify(saved));
    } catch (e) { }
    try {
        fetch(ADMIN_API_URL, {
            method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updateOrderPrice',
                orderId: orderId,
                newTotal: (target && target.total) || 0,
                shippingFee: (target && target.shippingFee) || 0,
                status: status,
                projectId: target && target.projectId
            })
        }).catch(() => { });
    } catch (e) { }
};

// [New] Safe Price Parser to handle currency symbols like $ and commas
window.safeParsePrice = function (val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    // Remove everything except numbers and decimal point
    const str = String(val).replace(/[^0-9.]/g, '');
    return parseFloat(str) || 0;
};

// [New] Safe Date Parser to handle both numeric timestamps and date strings from backend
window.safeParseDate = function (val) {
    if (!val) return new Date(0);
    // If it's already a Date object
    if (val instanceof Date) return val;
    // If it matches a purely numeric string (timestamp)
    if (typeof val === 'string' && /^\d+$/.test(val)) {
        return new Date(parseInt(val));
    }
    // Try standard Date parsing
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
    // Last resort: try parseInt anyway
    return new Date(parseInt(val) || 0);
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

        // 處理 6060 系列 (屬於 30 系列，但名稱可能不同)
        if (simple.includes("6060")) {
            let base = "6060";
            if (simple.includes("輕")) return base + "輕型";
            if (simple.includes("重")) return base + "重型";
            return base + "型";
        }

        // 處理 30/40 系列輕重型
        if (simple.includes("(輕量型)") || simple.includes("輕型") || simple.includes("輕量")) {
             let base = simple.substring(0, 4);
             return base + "輕型";
        }
        if (simple.includes("(標準型)") || simple.includes("重型") || simple.includes("標準")) {
             let base = simple.substring(0, 4);
             return base + "重型";
        }

        return simple;
    }

    // 2. 配件名稱標準化 (含螺絲)
    return window.convertToInventoryKey(name, series);
};


window.showPriceModal = function (order, nextStatus) {
    const modalBody = document.getElementById('modal-body');
    const modal = document.getElementById('modal');
    if (!modal || !modalBody) return;

    // 安全獲取訂單資料
    let target = ordersData.find(o => String(o.timestamp) === String(order.timestamp));
    if (!target) return;

    // 【防呆機制】：精準取得「系統原始料件小計」，避免重複開啟報價時發生疊加錯誤
    let currentTotal = parseInt(String(target.total).replace(/[^0-9]/g, '') || 0);
    let sysTotal = 0;
    
    // 如果之前有存過 sysTotal 就用存的，沒有的話就用 (總計 - 運費) 來推算
    if (target.sysTotal !== undefined) {
        sysTotal = target.sysTotal;
    } else {
        let existingShipping = parseInt(String(target.shippingFee || 0).replace(/[^0-9]/g, '') || 0);
        sysTotal = currentTotal - existingShipping;
    }
    if (sysTotal < 0) sysTotal = 0;

    // 讀取可能已經填寫過的擴充資料 (如果是第二次打開)
    let prevCost = target.costPrice || 0;
    let prevOutsource = target.outsourcePrice || 0;
    let prevAssembly = target.assemblyFee || 0;
    let prevShipping = target.shippingFee || 0;
    let prevDiscount = target.discountAmount || 0; // 新增折扣欄位
    let prevTaxType = target.taxType || 'inclusive';

    modalBody.innerHTML = `
        <div style="padding:15px 25px; text-align:left; color:var(--text);">
            <h3 style="color:var(--accent-30); text-align:center; margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:10px;"><i class="fas fa-calculator"></i> 報價精算面板</h3>
            
            <div style="background:#f8fafc; padding:15px; border-radius:8px; margin-bottom:15px; border:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; color:#64748b;">系統料件小計 (鋁材/自家配件)</span>
                <span style="font-size:1.2rem; font-weight:bold; color:var(--primary);">NT$ <span id="quote-sys-total">${formatPrice(sysTotal).replace('NT$','').trim()}</span></span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
                <!-- 成本區 (不對外顯示) -->
                <div style="background:#fff1f2; padding:15px; border-radius:8px; border:1px dashed #fecdd3;">
                    <h4 style="margin:0 0 10px 0; color:#e11d48; font-size:0.95rem;"><i class="fas fa-eye-slash"></i> 內部成本區 (會計用)</h4>
                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:0.8rem; margin-bottom:4px; color:#888;">外購進貨成本 (板材/五金等)</label>
                        <!-- 新增：輸入成本自動算出 1.2倍 -->
                        <input type="number" id="quote-cost-input" value="${prevCost}" oninput="document.getElementById('quote-outsource-input').value = Math.ceil((this.value || 0) * 1.2); updateQuotePreview()" style="width:100%; padding:8px; border:1px solid #fecdd3; border-radius:4px; outline:none; font-size:1.1rem; text-align:right;">
                    </div>
                </div>

                <!-- 報價區 (向客收費) -->
                <div style="background:#f0fdf4; padding:15px; border-radius:8px; border:1px dashed #bbf7d0;">
                    <h4 style="margin:0 0 10px 0; color:#16a34a; font-size:0.95rem;"><i class="fas fa-file-invoice-dollar"></i> 向客收費區 (給客人的報價)</h4>
                    
                    <div style="margin-bottom:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:4px;">
                            <label style="font-size:0.8rem; color:#888;">外購品報價 (預設 1.2倍)</label>
                            <!-- 變成平轉按鈕 -->
                            <button onclick="document.getElementById('quote-outsource-input').value = document.getElementById('quote-cost-input').value || 0; updateQuotePreview();" style="font-size:0.75rem; padding:2px 8px; background:#e2e8f0; border:none; border-radius:4px; cursor:pointer;">平轉 (原價)</button>
                        </div>
                        <input type="number" id="quote-outsource-input" value="${prevOutsource}" oninput="updateQuotePreview()" style="width:100%; padding:8px; border:1px solid #bbf7d0; border-radius:4px; outline:none; font-size:1.1rem; text-align:right;">
                    </div>

                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:0.8rem; margin-bottom:4px; color:#888;">加工與組裝費</label>
                        <input type="number" id="quote-assembly-input" value="${prevAssembly}" oninput="updateQuotePreview()" style="width:100%; padding:8px; border:1px solid #bbf7d0; border-radius:4px; outline:none; font-size:1.1rem; text-align:right;">
                    </div>

                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:0.8rem; margin-bottom:4px; color:#888;">向客收運費</label>
                        <input type="number" id="quote-shipping-input" value="${prevShipping}" oninput="updateQuotePreview()" style="width:100%; padding:8px; border:1px solid #bbf7d0; border-radius:4px; outline:none; font-size:1.1rem; text-align:right;">
                    </div>
                    
                    <!-- 新增：折扣優惠框 -->
                    <div style="margin-bottom:10px;">
                        <label style="display:block; font-size:0.8rem; margin-bottom:4px; color:#e11d48; font-weight:bold;">折扣優惠 (減去金額)</label>
                        <input type="number" id="quote-discount-input" value="${prevDiscount}" oninput="updateQuotePreview()" style="width:100%; padding:8px; border:1px solid #fecdd3; border-radius:4px; outline:none; font-size:1.1rem; text-align:right; color:#e11d48; background:#fff1f2;" placeholder="例如: 1100">
                    </div>
                </div>
            </div>

            <!-- 稅金選項 -->
            <div style="margin-bottom:15px; padding:10px 15px; border:1px solid #eee; border-radius:8px; background:#fff;">
                 <label style="display:block; font-size:0.85rem; font-weight:bold; margin-bottom:8px; color:#334155;">營業稅金計算：</label>
                 <div style="display:flex; gap:20px; font-size:0.9rem; color:#334155;">
                     <label style="cursor:pointer; color:#334155;"><input type="radio" name="tax_type" value="none" ${(!prevTaxType || prevTaxType === 'none') ? 'checked' : ''} onchange="updateQuotePreview()"> 未稅 (不開發票)</label>
                     <label style="cursor:pointer; color:#334155;"><input type="radio" name="tax_type" value="inclusive" ${prevTaxType === 'inclusive' ? 'checked' : ''} onchange="updateQuotePreview()"> 含稅 (開發票，自行吸收5%)</label>
                     <label style="cursor:pointer; color:#334155;"><input type="radio" name="tax_type" value="exclusive" ${prevTaxType === 'exclusive' ? 'checked' : ''} onchange="updateQuotePreview()"> 含稅 (開發票，外加5%)</label>
                 </div>
                 <div id="tax-amount-display" style="font-size:0.85rem; color:#e11d48; margin-top:8px; display:none; font-weight:bold;">+ 稅金 NT$ 0</div>
            </div>

            <div style="background:#334155; color:white; padding:15px; border-radius:8px; display:flex; justify-content:space-between; align-items:center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <span style="font-size:1.1rem;">給客人的最終報價總計</span>
                <span style="font-size:1.6rem; font-weight:bold; color:#fbbf24;">NT$ <span id="quote-final-total">${formatPrice(sysTotal).replace('NT$','').trim()}</span></span>
            </div>
            <div style="text-align:right; font-size:0.85rem; color:#94a3b8; margin-top:8px; padding-right:5px;">
                <i class="fas fa-info-circle"></i> 附加毛利(外包差價+加工費)：NT$ <span id="quote-profit-preview">0</span>
            </div>

            <div style="margin-top:25px; display:flex; justify-content:center; gap:12px;">
                 <button class="btn-secondary" onclick="closeModal()" style="padding:10px 20px; border-radius:8px;">取消</button>
                 <button id="btn-confirm-price" onclick="confirmQuotePrice('${order.timestamp}', '${nextStatus}')" 
                    style="flex:1; padding:12px; background:var(--accent-30); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:bold;">
                確認並發送報價信
            </button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    
    // 定義動態更新總計的函數
    window.updateQuotePreview = function() {
        let currentSys = parseInt(document.getElementById('quote-sys-total').innerText.replace(/,/g, '')) || 0;
        let cost = parseInt(document.getElementById('quote-cost-input').value) || 0;
        let outsource = parseInt(document.getElementById('quote-outsource-input').value) || 0;
        let assembly = parseInt(document.getElementById('quote-assembly-input').value) || 0;
        let shipping = parseInt(document.getElementById('quote-shipping-input').value) || 0;
        let discount = parseInt(document.getElementById('quote-discount-input').value) || 0;
        
        let subtotal = currentSys + outsource + assembly + shipping - discount;
        let taxType = document.querySelector('input[name="tax_type"]:checked').value;
        let taxAmount = 0;
        let finalTotal = subtotal;

        const taxDisplay = document.getElementById('tax-amount-display');
        
        if (taxType === 'exclusive') {
            taxAmount = Math.round(subtotal * 0.05);
            finalTotal = subtotal + taxAmount;
            taxDisplay.innerText = '+ 稅金 NT$ ' + taxAmount.toLocaleString();
            taxDisplay.style.color = '#e11d48';
            taxDisplay.style.display = 'block';
        } else if (taxType === 'inclusive') {
            taxAmount = subtotal - Math.round(subtotal / 1.05);
            taxDisplay.innerText = '(內含稅金約 NT$ ' + taxAmount.toLocaleString() + '，由我方吸收)';
            taxDisplay.style.color = '#888';
            taxDisplay.style.display = 'block';
        } else {
            taxDisplay.style.display = 'none';
        }

        document.getElementById('quote-final-total').innerText = finalTotal.toLocaleString();
        
        // 附加毛利計算絕對「不包含折扣」，反映真實的外包加工利潤
        let profit = (outsource - cost) + assembly; 
        document.getElementById('quote-profit-preview').innerText = profit.toLocaleString();
    };

    // 觸發第一次計算
    window.updateQuotePreview();

    setTimeout(() => {
        const input = document.getElementById('quote-shipping-input');
        if (input) { input.focus(); }
    }, 100);
};

// 生成 Email 報價內容
window.generateMailBody = function (name, sysTotal, outsource, assembly, shippingFee, discount, taxType, taxAmount, finalTotal, details, truncate = false) {
    let formattedDetails = (details || "無詳細明細");

    if (truncate && formattedDetails.length > 1200) {
        let cutoff = formattedDetails.lastIndexOf('\n', 1200);
        if (cutoff === -1) cutoff = 1200;
        formattedDetails = formattedDetails.substring(0, cutoff);
    }
    formattedDetails = formattedDetails.replace(/\\n/g, '\n').replace(/\n/g, '\n');

    let extraLines = "";
    if (outsource > 0) extraLines += `外購品/客製品項： ${formatPrice(outsource)}\n`;
    if (assembly > 0) extraLines += `加工與組裝費： ${formatPrice(assembly)}\n`;
    if (discount > 0) extraLines += `折扣優惠： -${formatPrice(discount)}\n`; // Email內顯示折扣
    
    let shippingDisplay = (shippingFee > 0) ? formatPrice(shippingFee) : "免運費";
    let taxLine = (taxType === 'exclusive') ? `營業稅 (5%)： ${formatPrice(taxAmount)}\n` : "";
    let taxNote = "";
    if (taxType === 'exclusive') taxNote = "(本報價含外加5%營業稅)";
    if (taxType === 'inclusive') taxNote = "(本報價為含稅價)";

    return `您好，ALUMIBRO 鋁材兄弟已收到您的訂單。

訂單明細如下：
${formattedDetails}

-------------------
鋁材與配件小計： ${formatPrice(sysTotal)}
${extraLines}運費金額： ${shippingDisplay}
${taxLine}-------------------
總計金額： ${formatPrice(finalTotal)} ${taxNote}

匯款資訊如下：
銀行代碼：xxx
帳號：xxx`;
};

window.confirmQuotePrice = function (orderId, nextStatus) {
    // 獲取所有填寫的金額
    let sysTotal = parseInt(document.getElementById('quote-sys-total').innerText.replace(/,/g, '')) || 0;
    let cost = parseInt(document.getElementById('quote-cost-input').value) || 0;
    let outsource = parseInt(document.getElementById('quote-outsource-input').value) || 0;
    let assembly = parseInt(document.getElementById('quote-assembly-input').value) || 0;
    let shipping = parseInt(document.getElementById('quote-shipping-input').value) || 0;
    let discount = parseInt(document.getElementById('quote-discount-input').value) || 0;
    let taxType = document.querySelector('input[name="tax_type"]:checked').value;

    if (shipping === 0) {
        if (!confirm("運費為 0，確定是免運嗎？")) return;
    }

    let target = ordersData.find(o => String(o.timestamp) === String(orderId));
    if (target) {
        let subtotal = sysTotal + outsource + assembly + shipping - discount;
        let taxAmount = 0;
        if (taxType === 'exclusive') taxAmount = Math.round(subtotal * 0.05);
        if (taxType === 'inclusive') taxAmount = subtotal - Math.round(subtotal / 1.05);
        let finalTotal = (taxType === 'exclusive') ? subtotal + taxAmount : subtotal;

        // 更新本地資料 (嚴格儲存分解數值，防呆)
        target.total = finalTotal;
        target.shippingFee = shipping; 
        target.status = nextStatus;
        target.sysTotal = sysTotal;
        target.costPrice = cost;
        target.outsourcePrice = outsource;
        target.assemblyFee = assembly;
        target.discountAmount = discount;
        target.taxType = taxType;
        target.taxAmount = taxAmount;

        applyFilter();
        window.lastActiveOrderId = orderId;

        // 送資料到後端 (擴充欄位，含 discountAmount)
        fetch(ADMIN_API_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updateOrderPrice',
                orderId: orderId, 
                newTotal: finalTotal,
                shippingFee: shipping, 
                status: nextStatus,
                costPrice: cost,             
                outsourcePrice: outsource,   
                assemblyFee: assembly,       
                taxType: taxType,            
                taxAmount: taxAmount,
                discountAmount: discount,
                sysTotal: sysTotal,
                projectId: target.projectId
            })
        }).then(() => console.log('Advanced price update sent to backend'))
          .catch(e => console.error('Failed to update backend price', e));

        // 開啟 Gmail
        if (target.email) {
            let mailSubject = encodeURIComponent(`ALUMIBRO訂購報價回覆 - ${target.name}`);
            let rawBody = window.generateMailBody(target.name, sysTotal, outsource, assembly, shipping, discount, taxType, taxAmount, finalTotal, target.details);
            let mailBody = encodeURIComponent(rawBody);

            if (mailBody.length > 1800) {
                rawBody = window.generateMailBody(target.name, sysTotal, outsource, assembly, shipping, discount, taxType, taxAmount, finalTotal, target.details, true);
                mailBody = encodeURIComponent(rawBody);
            }
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

    // For packing, we skip checking entirely. Only require checking for inspection or picking.
    if (['inspection', 'picking'].includes(currentStatus)) {
        // 確認所有項目都已勾選
        const allCards = document.querySelectorAll('.detail-card');
        const checkedCards = document.querySelectorAll('.detail-card.checked');

        if (allCards.length !== checkedCards.length) {
            alert('尚有項目未核對完成！');
            return;
        }
    }

    // 根據當前狀態自動前進到下一階段
    if (['inspection', 'picking', 'packing'].includes(currentStatus)) {
        // Visual feedback
        const btn = document.getElementById('btn-finish-check');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 處理中...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            btn.style.cursor = 'wait';
        }

        // Delay to allow UI to update
        setTimeout(() => {
            // closeModal(); // [Fix] REMOVED to show deduction progress in advanceStatus
            const nextStatusMap = {
                'inspection': 'picking',
                'picking': 'packing',
                'packing': 'shipping'
            };
            const nextStatus = nextStatusMap[currentStatus];
            if (nextStatus) {
                advanceStatus(order.timestamp, nextStatus);
            } else {
                advanceStatus(order.timestamp, currentStatus);
            }
            // We don't need to restore the button state here because closeModal hides it/destroys it
        }, 50);

    } else {
        closeModal();
    }
};

// --- GLOBAL VARS ---
let ordersData = [];
let filteredOrders = [];
let currentFilter = 'all';

// Track which columns are expanded on mobile to preserve state across renders
window.expandedColumns = new Set();

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
        user-select: none; background: transparent; padding: 1px 6px; border: 1px solid #eee;
        border-radius: 3px; margin-bottom: 2px; font-size: 0.82rem; line-height: 1.25;
        min-height: 0;
    }
    .check-box {
        width: 18px; height: 18px; border: 2px solid #ddd; border-radius: 3px; margin-right: 8px;
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        transition: all 0.2s; background: #fff;
    }
    
    /* 系列顏色 - 勾選後的背景色 */
    .detail-card.checked { opacity: 0.7; }
    .detail-card.checked .check-box i { display: block !important; color: #fff; font-size: 14px; }
    
    /* 20系列 - 藍板岩 */
    .detail-card.series-20.checked { background: #eff6ff; border-color: #93c5fd; }
    .detail-card.series-20.checked .check-box { background: var(--accent-20); border-color: var(--accent-20); }
    
    /* 30系列 - 暖茶色 */
    .detail-card.series-30.checked { background: #fff7ed; border-color: #fdba74; }
    .detail-card.series-30.checked .check-box { background: var(--accent-30); border-color: var(--accent-30); }
    
    /* 40系列 - 鼠尾草綠 */
    .detail-card.series-40.checked { background: #f0fdf4; border-color: #86efac; }
    .detail-card.series-40.checked .check-box { background: var(--accent-40); border-color: var(--accent-40); }
    
    /* 其他/未分類 - 預設莫蘭迪灰 */
    .detail-card.checked:not([class*="series-"]) { background: #f8f9fa; border-color: #d1d5db; }
    .detail-card.checked:not([class*="series-"]) .check-box { background: var(--ash-gray); border-color: var(--ash-gray); }
    
    .detail-card .d-name { flex: 1; line-height: 1.3; font-size: 0.88rem; }

    .checklist-progress-bar {
        position: sticky; top: 0; background: #fff; z-index: 10; padding: 10px;
        margin: -10px -10px 10px -10px; border-bottom: 1px solid #eee;
        display: flex; justify-content: space-between; align-items: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .progress-pill.complete { background: #27ae60; color: #fff; }
    
    .btn-finish-check {
        width: 100%; padding: 12px; background: #e2e8f0; color: #64748b; border: none;
        border-radius: 6px; font-size: 1.1em; margin-top: 10px; cursor: pointer; transition: 0.2s;
    }
    .btn-finish-check.active { background: var(--accent-warehouse); color: #fff; cursor: pointer; }
    .btn-finish-check.active:hover { filter: brightness(1.1); transform: translateY(-1px); }


    .btn-print {
        background: #a0a0a0; color: white; border: none; padding: 6px 15px;
        border-radius: 6px; cursor: pointer; font-size: 0.9em; display: flex; align-items: center; gap: 6px;
        transition: 0.2s;
    }
    .btn-print:hover { background: #888; }

    .btn-close-inline {
        background: #eee; color: #555; border: none; padding: 6px 12px;
        border-radius: 4px; cursor: pointer; font-size: 0.9em;
    }

    /* Email Reply Button - Muted Rose - Morandi Palette */
    .kanban-card .btn-gmail, a.btn-gmail {
        background: var(--accent-mail) !important; /* Muted Rose */
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
    .kanban-card .btn-gmail:hover, a.btn-gmail:hover { filter: brightness(0.9); }
    
    /* Column Header Colors for Work Flow */
    /* Factory Flow (Slate Blue) */
    .status-cutting { background: var(--accent-20); color: #fff; border: none; } 

    /* Warehouse & Logistics Flow (Smoky Purple) */
    .status-inspection, .status-picking, .status-packing { background: var(--accent-warehouse); color: #fff; border: none; } 

    /* Logistics Flow (Moss Green) */
    .status-shipping, .status-dispatched { background: var(--accent-40); color: #fff; border: none; } 

    /* Customer Service Flow (Warm Tea) */
    .status-unquoted, .status-quoted, .status-paid { background: var(--accent-30); color: #fff; border: none; } 

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
        font-weight: 400;
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
        font-weight: 300;
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
        font-weight: 400;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        margin-left: 10px;
        white-space: nowrap;
        transition: transform 0.2s;
    }
    .btn-merge-cut:hover { transform: scale(1.05); background: #c0392b !important; }
        .btn-prev {
        background: #f1f5f9 !important;
        color: #94a3b8 !important;
        border: 1px solid #e2e8f0 !important;
    }
    .btn-prev:hover {
        background: #e2e8f0 !important;
        color: #64748b !important;
    }
    
</style>
`;
document.head.insertAdjacentHTML("beforeend", customStyles);


document.addEventListener('DOMContentLoaded', () => {
    // [Visual Test] Confirm script is updated
    console.log("Admin Logic v2 loaded");

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
    initMobileAccordion();
});

// Global Event Delegation for Mobile Accordion - ONLY ADD ONCE
document.addEventListener('click', function (e) {
    // Only activate on mobile
    if (window.innerWidth > 768) return;

    const header = e.target.closest('.column-header');
    if (!header) return;

    const column = header.closest('.kanban-column');
    if (!column) return;

    const body = column.querySelector('.column-body');
    if (!body) return;

    // Extract status key from header class (e.g., status-unquoted)
    const statusMatch = header.className.match(/status-([a-z0-0_-]+)/i);
    const statusKey = statusMatch ? statusMatch[1] : null;

    // Toggle collapsed state
    const isNowCollapsed = header.classList.toggle('collapsed');
    body.classList.toggle('collapsed');

    // Update global sticky state
    if (statusKey) {
        if (isNowCollapsed) {
            window.expandedColumns.delete(statusKey);
        } else {
            window.expandedColumns.add(statusKey);
        }
    }
});

// Initialize mobile accordion states (Only needed for first run or cross-tab resets)
function initMobileAccordion() {
    // Only activate on mobile
    if (window.innerWidth > 768) return;

    // We no longer need to force-collapse everything here because renderKanban 
    // already uses window.expandedColumns to set the 'collapsed' class correctly.
    // This function can now be empty or handle specific one-time setups.
}

// Re-setup accordion when window is resized
window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
        // Just re-init states if needed, don't add new listeners
        // (Wait for render usually)
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

function showAdminHub() {
    try {
        const loginOverlay = document.getElementById('login-overlay');
        const dashboard = document.getElementById('dashboard');
        const historyMod = document.getElementById('history-module');
        const reportsMod = document.getElementById('reports-module');
        const hub = document.getElementById('admin-hub');

        if (loginOverlay) loginOverlay.classList.add('hidden');
        if (dashboard) dashboard.classList.add('hidden');
        if (historyMod) historyMod.classList.add('hidden');
        if (hub) hub.classList.remove('hidden');

        // Show 3D Background in Hub
        const bg = document.getElementById('three-canvas-container');
        if (bg) bg.classList.remove('hidden');

        // Start background fetch for accurate stats
        fetchOrders().then(() => updateHubStats()).catch(e => console.error("Update Stats Error:", e));

        // Preload calendar so hub preview shows today's events
        if (typeof window.preloadCalendarForHub === 'function') {
            window.preloadCalendarForHub();
        }

        // 第一次進後台沒有選名字，跳「你是誰？」對話框
        setTimeout(() => {
            if (typeof window.getCurrentUser === 'function' && !window.getCurrentUser()) {
                if (typeof window.fetchCalendarMembers === 'function') {
                    window.fetchCalendarMembers().then(() => {
                        if (typeof window.showWhoModal === 'function') window.showWhoModal();
                    });
                }
            }
        }, 800);
    } catch (e) {
        console.error("Show Admin Hub Error:", e);
    }
}

function navigateTo(module, subView) {
    console.log(`🚀 navigateTo: module=${module}, subView=${subView}`);

    // 1. SET STATE IMMEDIATELY & SYNCHRONOUSLY (Critical for applyFilter race conditions)
    if (module === 'orders') {
        if (subView === 'inventory') window.currentPrimaryView = 'inventory';
        else if (subView === 'work') window.currentPrimaryView = 'work';
        else if (subView === 'shipment') window.currentPrimaryView = 'shipment';
        else window.currentPrimaryView = 'all';
    }

    const hub = document.getElementById('admin-hub');
    const dashboard = document.getElementById('dashboard');
    const board = document.getElementById('kanban-board');
    const inventory = document.getElementById('inventory-section');
    const TRANSITION_MS = 400;

    // 2. SET VISIBILITY IMMEDIATELY (Prevents flashing/ghosting of last view)
    if (module === 'orders') {
        if (window.currentPrimaryView === 'inventory') {
            if (board) board.classList.add('hidden');
            if (inventory) inventory.classList.remove('hidden');
            // NEW: Fire dashboard render
            setTimeout(() => renderInventoryDashboard(), 100);
        } else {
            if (board) board.classList.remove('hidden');
            if (inventory) inventory.classList.add('hidden');
        }
    }

    // Step 1: Fade out the hub
    hub.style.transition = `opacity ${TRANSITION_MS}ms ease`;
    hub.style.opacity = '0';

    // Step 2: After fade out, hide hub and show target with fade in
    setTimeout(() => {
        hub.classList.add('hidden');
        hub.style.opacity = '';
        hub.style.transition = '';

        // Determine the target element
        let targetEl;
        if (module === 'orders') {
            targetEl = dashboard;
        } else if (module === 'history') {
            targetEl = document.getElementById('history-module');
        } else if (module === 'reports') {
            targetEl = document.getElementById('reports-module');
        } else if (module === 'calendar') {
            targetEl = document.getElementById('calendar-module');
        }

        // Prepare fade-in
        if (targetEl) {
            targetEl.style.opacity = '0';
            targetEl.classList.remove('hidden');
            targetEl.style.transition = `opacity ${TRANSITION_MS}ms ease`;
            void targetEl.offsetWidth;
            targetEl.style.opacity = '1';

            // Module-specific routing
            if (module === 'orders') {
                const performRouting = () => {
                    if (subView === 'work') window.showWorkOrders();
                    else if (subView === 'shipment') window.showWarehouseShipment();
                    else if (subView === 'inventory') window.showInventory();
                    else showAllOrders();
                };

                if (!ordersData || !ordersData.length) {
                    // [快取] 先從 localStorage 快取立即顯示，背景刷新資料
                    try {
                        const cached = localStorage.getItem('orders_cache');
                        if (cached) {
                            const savedStatuses = JSON.parse(localStorage.getItem('order_statuses') || '{}');
                            const STATUS_ORDER = ['unquoted', 'quoted', 'paid', 'cutting', 'inspection', 'picking', 'packing', 'shipping', 'dispatched', 'completed'];
                            const _rank = s => STATUS_ORDER.indexOf(s);
                            ordersData = JSON.parse(cached).map(order => {
                                let key = String(order.timestamp);
                                const localStatus = savedStatuses[key];
                                // 只在「本機進度較前面」時才用本機，否則用快取裡的後端值（與 fetchOrders 同規則）
                                if (localStatus && _rank(localStatus) > _rank(order.status || '')) order.status = localStatus;
                                return order;
                            });
                            window.assignProjectIds(); // 補上全域專案編號
                            performRouting(); // 立即顯示快取資料
                            fetchOrders();   // 背景悄悄更新
                        } else {
                            fetchOrders().then(performRouting); // 無快取：等待 API
                        }
                    } catch (e) {
                        fetchOrders().then(performRouting);
                    }
                } else {
                    performRouting();
                    fetchOrders(); // Refresh in background
                }
            } else if (module === 'history') {
                if (!ordersData.length) fetchOrders().then(() => renderHistoryOrders());
                else renderHistoryOrders();
            } else if (module === 'reports') {
                if (ordersData.length > 0) renderFinancialReports();
                fetchOrders().then(() => renderFinancialReports());
            } else if (module === 'calendar') {
                if (typeof window.initCalendarModule === 'function') {
                    window.initCalendarModule();
                }
            }

            setTimeout(() => {
                targetEl.style.opacity = '';
                targetEl.style.transition = '';
            }, TRANSITION_MS);
        }

        // Handle 3D Background
        const bg = document.getElementById('three-canvas-container');
        if (bg) {
            bg.classList.add('three-bg-hidden');
            isThreeJsPaused = true;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
        }
    }, TRANSITION_MS);
};

// ==========================================
// INVENTORY DASHBOARD (戰情面板)
// ==========================================
window.renderInventoryDashboard = function () {
    // [自家成品] 動態補上第三張分類卡（不需改 admin.html）
    (function () {
        var hub = document.getElementById('inventory-hub');
        if (hub && !hub.querySelector('[data-cat="finished"]')) {
            var card = document.createElement('div');
            card.className = 'category-card';
            card.setAttribute('data-cat', 'finished');
            card.setAttribute('onclick', "switchInventoryCategory('finished')");
            card.innerHTML = '<div class="category-card-inner"><i class="fas fa-box-open category-icon"></i><div class="category-text"><div class="category-name">自家成品總覽</div><div class="category-desc">手機架、餐車等自家成品庫存</div></div></div>';
            hub.appendChild(card);
        }
    })();
    if (!window.allInventory || window.allInventory.length === 0) return;

    try {
        const parseNum = (val) => {
            if (!val) return 0;
            const num = Number(val.toString().trim());
            return isNaN(num) ? 0 : num;
        };

        const findValue = (obj, keys) => {
            if (!obj || typeof obj !== 'object') return undefined;
            const objKeys = Object.keys(obj);
            // 1. Exact or Trimmed Match
            for (const k of objKeys) {
                const cleanK = k.trim().toLowerCase();
                if (keys.some(target => target.trim().toLowerCase() === cleanK)) return obj[k];
            }
            // 2. Partial Match
            for (const k of objKeys) {
                const cleanK = k.trim().toLowerCase();
                if (keys.some(target => cleanK.includes(target.toLowerCase()) || target.toLowerCase().includes(cleanK))) {
                    return obj[k];
                }
            }
            return undefined;
        };

        const generateReservoirHTML = (index, pct, valueLabel, mainLabel, options = {}) => {
            const visualPct = Math.max(0, Math.min(100, Math.round(pct)));
            const isCritical = options.isCritical || pct < 20;
            const radius = 25, viewBox = `0 0 70 70`, center = 35;
            const maskId = `reservoir-mask-${index}`;
            const fillY = center + radius - (visualPct / 100) * (radius * 2);

            const activeColor = options.activeColor || (isCritical ? 'var(--dusty-rose)' : '#cbd5e1');
            const textColor = options.textColor || (isCritical ? 'var(--dusty-rose)' : '#475569');
            const circleColor = options.circleColor || (isCritical ? 'var(--dusty-rose)' : '#e2e8f0');
            const customClass = options.className || '';

            return `
            <div class="reservoir-circle-container ${customClass}" style="display:flex; flex-direction:column; align-items:center; opacity: 1; padding: 0 4px;">
                <svg width="80" height="80" viewBox="${viewBox}" class="reservoir-svg" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.05)); margin-bottom: 2px;">
                    <circle cx="${center}" cy="${center}" r="${radius}" fill="#f8fafc" stroke="${circleColor}" stroke-width="2" />
                    <defs><clipPath id="${maskId}"><circle cx="${center}" cy="${center}" r="${radius}" /></clipPath></defs>
                    <g clip-path="url(#${maskId})">
                        <g class="reservoir-fill-group">
                            <rect x="-70" y="${fillY}" width="210" height="100" fill="${activeColor}" />
                            ${visualPct > 0 && visualPct < 100 ? `
                                <path d="M 0 ${fillY} q 17.5 -8 35 0 t 35 0 35 0 35 0 35 0 35 0" fill="${activeColor}" opacity="0.3" class="reservoir-wave-slow" />
                                <path d="M 0 ${fillY} q 17.5 -5 35 0 t 35 0 35 0 35 0 35 0 35 0" fill="${activeColor}" opacity="0.6" class="reservoir-wave" />
                            ` : ''}
                        </g>
                    </g>
                    <text x="${center}" y="${center + 4}" text-anchor="middle" font-size="14" font-weight="600" 
                          fill="${visualPct > 50 ? '#fff' : textColor}" 
                          style="text-shadow: ${visualPct > 50 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none'}; pointer-events: none;">
                        ${Math.round(pct)}%
                    </text>
                </svg>
                <div class="reservoir-value" style="color: ${textColor}; margin-top:0; font-size:0.7rem; font-weight:bold; min-height: 1.2em; line-height: 1.2; white-space: nowrap;">${valueLabel}</div>
                <div class="reservoir-label" style="font-size: 0.8rem; overflow:visible; white-space:nowrap; max-width:none; margin-top:2px; font-weight: 500; color: var(--primary); min-height: 1.2em; line-height: 1.2;">${mainLabel}</div>
            </div>`;
        };

        const MAX_HEALTH_MAP = { 20: 120000, 30: 360000, 40: 240000 };
        let health = { 20: 0, 30: 0, 40: 0 };
        const ALUMINUM_ALLOW_LIST = ["2020型", "2040型", "3030輕型", "3060輕型", "3030重型", "3060重型", "6060輕型", "6060重型", "4040輕型", "4080輕型", "4040重型", "4080重型"];
        let accessories = [];

        window.allInventory.forEach(item => {
            const rawName = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();
            if (!rawName) return;

            // 1. Precise Aluminum Matching - 6060 belongs to Series 30
            let series = 0;
            if (rawName.includes('6060')) series = 30; // 6060型屬於 30 系列
            else if (rawName.match(/^20/)) series = 20;
            else if (rawName.match(/^30/)) series = 30;
            else if (rawName.match(/^40/)) series = 40;

            const isAluminumProfile = ALUMINUM_ALLOW_LIST.some(model => rawName.includes(model));

            if (isAluminumProfile && series > 0) {
                // Try to find total length directly first, then fallback to qty * len
                let totalLen = parseNum(findValue(item, ['總長度', '總長度(cm)', 'total_length']));
                if (totalLen === 0) {
                    let qty = parseNum(findValue(item, ['qty', 'stock', '庫存數量', '數量', '庫存', '支數']));
                    let len = parseNum(findValue(item, ['長度', '長度(cm)', 'length']));
                    if (len === 0) len = 600;

                    // HEURISTIC: If qty is > 5000, it's likely already the total CM
                    if (qty > 5000) {
                        totalLen = qty;
                    } else {
                        totalLen = qty * len;
                    }
                }
                health[series] += totalLen;
            } else {
                // 2. Accessory Matching
                if (rawName.match(/^(20|30|40|HR)-/) || rawName.match(/\[(A|M|HR)/)) {
                    accessories.push(item);
                }
            }
        });

        // Update Aluminum Gauges (Left Side) — 細長條版
        const aluminumContainer = document.querySelector('.gauges-container');
        if (aluminumContainer) {
            const aluColors = { 20: 'rgba(179,199,217,0.55)', 30: 'rgba(198,166,130,0.55)', 40: 'rgba(184,204,184,0.55)' };
            let totalCurrent = 0, totalMax = 0;
            const rows = [20, 30, 40].map(s => {
                const maxHealth = MAX_HEALTH_MAP[s] || 240000;
                const currentCm = health[s] || 0;
                totalCurrent += currentCm;
                totalMax += maxHealth;
                const pct = Math.round((currentCm / maxHealth) * 100);
                const fillWidth = Math.max(0, Math.min(pct, 100));
                const isLow = pct < 20;
                const barColor = isLow ? 'rgba(212,160,160,0.6)' : aluColors[s];
                const pctColor = isLow ? '#f0c4c4' : 'rgba(255,255,255,0.85)';
                return `
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:0.7rem; color:rgba(255,255,255,0.5); min-width:36px;">${s} 系</span>
                    <div style="flex:1; height:6px; background:rgba(255,255,255,0.06); border-radius:99px; overflow:hidden;">
                        <div style="height:100%; width:${fillWidth}%; background:${barColor}; border-radius:99px; transition:width 1.2s cubic-bezier(0.4,0,0.2,1);"></div>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:3px; min-width:40px; justify-content:flex-end;">
                        <span style="font-size:0.85rem; font-weight:500; color:${pctColor}; font-variant-numeric:tabular-nums;">${pct}</span>
                        <span style="font-size:0.65rem; color:rgba(255,255,255,0.4);">%</span>
                    </div>
                </div>`;
            }).join('');
            const totalM = (totalCurrent / 100).toFixed(0);
            const totalMaxM = (totalMax / 100).toFixed(0);
            aluminumContainer.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:9px; width:100%;">
                    ${rows}
                </div>
                <div style="margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.06); font-size:0.65rem; color:rgba(255,255,255,0.35); font-variant-numeric:tabular-nums; width:100%;">
                    總長度 ${Number(totalM).toLocaleString()} / ${Number(totalMaxM).toLocaleString()} m
                </div>`;
            aluminumContainer.style.display = 'flex';
            aluminumContainer.style.flexDirection = 'column';
            aluminumContainer.style.justifyContent = 'flex-start';
            aluminumContainer.style.width = '100%';
        }

        // Accessoriess Mapping
        let accCounts = accessories.map(i => {
            let findRes = findValue(i, ['name', '品項名稱', '品項']);
            let name = (findRes !== undefined && findRes !== null ? findRes : "未知").toString().trim();
            let qty = parseNum(findValue(i, ['qty', 'stock', '庫存數量', '數量', '庫存']));

            let skuMatch = name.match(/\[([^\]]+)\]/);
            let displaySku = skuMatch ? `[${skuMatch[1]}]` : name;

            let cleanBase = name;
            if (typeof window.removeSKU === 'function') {
                try { cleanBase = window.removeSKU(name) || name; } catch (e) { }
            } else {
                cleanBase = name.replace(/\[([^\]]+)\]/, '').trim();
            }

            let baseName = String(cleanBase).replace(/^(20|30|40|80)-/, '').trim();
            baseName = baseName.replace(/^M\d+/, '').trim();
            baseName = baseName.replace(/^\d+mm/, '').trim();

            const checkIsScrewOrNutSet = (n) => {
                if (!n) return false;
                const low = String(n).toLowerCase();
                return low.includes('螺絲') || low.includes('螺母') || low.includes('螺帽') || low.includes('滑塊') || low.includes('彈片');
            };
            const defaultMax = checkIsScrewOrNutSet(baseName) ? 1000 : 100;
            let pctFilled = (qty / defaultMax) * 100;

            return { name, displaySku, qty, max: defaultMax, pctFilled };
        });

        accCounts.sort((a, b) => (isNaN(a.pctFilled) ? 0 : a.pctFilled) - (isNaN(b.pctFilled) ? 0 : b.pctFilled));
        let top5 = accCounts.slice(0, 5);
        const barsContainer = document.getElementById('low-stock-bars');

        if (barsContainer) {
            if (top5.length === 0) {
                barsContainer.innerHTML = '<div style="color:#aaa; text-align:center;">目前無配件資料</div>';
            } else {
                barsContainer.style.display = 'flex';
                barsContainer.style.flexDirection = 'column';
                barsContainer.style.justifyContent = 'flex-start';
                barsContainer.style.alignItems = 'stretch';
                barsContainer.style.gap = '8px';
                barsContainer.style.flexWrap = 'nowrap';
                barsContainer.style.overflow = 'visible';
                barsContainer.style.paddingBottom = '0';
                barsContainer.style.height = 'auto';
                barsContainer.style.width = '100%';

                const sBadge = {
                    20: { bg: 'rgba(179,199,217,0.12)', text: 'rgba(179,199,217,0.9)', border: 'rgba(179,199,217,0.25)' },
                    30: { bg: 'rgba(198,166,130,0.12)', text: 'rgba(198,166,130,0.9)', border: 'rgba(198,166,130,0.25)' },
                    40: { bg: 'rgba(184,204,184,0.12)', text: 'rgba(184,204,184,0.9)', border: 'rgba(184,204,184,0.25)' }
                };
                barsContainer.innerHTML = top5.map((item, index) => {
                    const pct = Math.round(item.pctFilled || 0);
                    const fillWidth = Math.max(0, Math.min(pct, 100));
                    const mainLabel = item.displaySku || "未知";
                    const s = window.detectSeries(item.name);
                    const badge = sBadge[s] || sBadge[20];
                    return `
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-family:'Consolas',monospace; font-size:0.62rem; color:${badge.text}; background:${badge.bg}; padding:2px 5px; border-radius:4px; border:1px solid ${badge.border}; min-width:90px; max-width:90px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${mainLabel}</span>
                        <div style="flex:1; height:6px; background:rgba(255,255,255,0.06); border-radius:99px; overflow:hidden;">
                            <div style="height:100%; width:${fillWidth}%; background:rgba(212,160,160,0.6); border-radius:99px;"></div>
                        </div>
                        <div style="display:flex; align-items:baseline; gap:3px; min-width:50px; justify-content:flex-end;">
                            <span style="font-size:0.85rem; font-weight:500; color:#f0c4c4; font-variant-numeric:tabular-nums;">${item.qty}</span>
                            <span style="font-size:0.65rem; color:rgba(255,255,255,0.4);">件</span>
                        </div>
                    </div>`;
                }).join('');
            }
        }
    } catch (err) {
        console.error("Dashboard overall failure:", err);
        const barsContainer = document.getElementById('low-stock-bars');
        if (barsContainer) {
            barsContainer.innerHTML = `<div style="color:var(--accent-mail); padding:10px; font-size:12px; font-weight:bold; white-space:pre-wrap;">圖表渲染錯誤: <br>${err.message}</div>`;
        }
    }
};

function backToHub() {
    const TRANSITION_MS = 400;
    const dashboard = document.getElementById('dashboard');
    const historyMod = document.getElementById('history-module');
    const reportsMod = document.getElementById('reports-module');
    const calendarMod = document.getElementById('calendar-module');
    const hub = document.getElementById('admin-hub');

    // Find which module is currently visible
    const activeModule = [dashboard, historyMod, reportsMod, calendarMod].find(el => el && !el.classList.contains('hidden'));

    // [Step 0] Start restoring 3D background IMMEDIATELY so it fades in during module fade-out
    const bg = document.getElementById('three-canvas-container');
    if (bg) {
        // Resume animation first so there's content to show
        if (isThreeJsPaused && threeJsAnimateFunc) {
            isThreeJsPaused = false;
            threeJsAnimateFunc();
        }
        // Then remove the hidden class to trigger the CSS opacity transition (0.5s ease)
        bg.classList.remove('three-bg-hidden');
    }

    // [Step 1] Fade out the active module
    if (activeModule) {
        activeModule.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        activeModule.style.opacity = '0';
    }

    setTimeout(() => {
        // Hide all modules
        dashboard.classList.add('hidden');
        historyMod.classList.add('hidden');
        reportsMod.classList.add('hidden');
        if (calendarMod) calendarMod.classList.add('hidden');
        if (activeModule) {
            activeModule.style.opacity = '';
            activeModule.style.transition = '';
        }

        // [Step 2] Show hub with fade in (3D background is already visible behind it)
        hub.style.opacity = '0';
        hub.classList.remove('hidden');
        hub.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        void hub.offsetWidth;
        hub.style.opacity = '1';
        setTimeout(() => {
            hub.style.opacity = '';
            hub.style.transition = '';
        }, TRANSITION_MS);

        updateHubStats();
    }, activeModule ? TRANSITION_MS : 0);
}

// 供其他地方刷新 Hub 數字用
function updateHubStats() {
    try {
        if (!ordersData || ordersData.length === 0) return;

        // 進行中訂單數 (排除未報價與已完成)
        const activeOrders = ordersData.filter(o => o.status !== 'completed' && o.status !== 'unquoted').length;

        // 歷史訂單數 (已完成)
        const historyOrders = ordersData.filter(o => o.status === 'completed').length;

        // 本月營收
        const now = new Date();
        const currentMonth = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0');
        let monthlyRevenue = 0;

        ordersData.forEach(o => {
            if (o.status === 'completed' && o.timestamp) {
                const rowDate = window.safeParseDate(o.timestamp);
                const rowMonth = rowDate.getFullYear() + '/' + String(rowDate.getMonth() + 1).padStart(2, '0');
                if (rowMonth === currentMonth) {
                    // Use safeParsePrice to ensure $ and commas don't break it
                    monthlyRevenue += window.safeParsePrice(o.total);
                }
            }
        });

        const statOrders = document.getElementById('hub-stat-orders');
        const statHistory = document.getElementById('hub-stat-history');
        const statReports = document.getElementById('hub-stat-reports');

        // New Shortcut Stats
        const statWork = document.getElementById('hub-stat-shortcut-work');
        const statShipment = document.getElementById('hub-stat-shortcut-shipment');

        // Logic for shortcuts
        const workCount = ordersData.filter(o => ['paid', 'cutting', 'inspection', 'picking', 'packing'].includes(o.status)).length;
        const shipmentCount = ordersData.filter(o => ['shipping', 'dispatched'].includes(o.status)).length;

        if (statOrders) statOrders.innerHTML = `<i class="fas fa-play-circle"></i> 進行中 ${activeOrders} 筆`;
        if (statHistory) statHistory.innerHTML = `<i class="fas fa-check-circle"></i> 累計完成 ${historyOrders} 筆`;
        if (statReports) statReports.innerHTML = `<i class="fas fa-dollar-sign"></i> 本月營收 $${monthlyRevenue.toLocaleString()}`;

        if (statWork) statWork.innerHTML = `<i class="fas fa-tasks"></i> 剩餘 ${workCount} 筆`;
        if (statShipment) statShipment.innerHTML = `<i class="fas fa-box"></i> 待出 ${shipmentCount} 筆`;
    } catch (e) {
        console.error("Update Hub Stats Error:", e);
    }
}

function showDashboard() {
    // Legacy support: if someone calls showDashboard, go to Hub instead or just show Dashboard
    // But login usually redirects here. So we redirect to Admin Hub context.
    showAdminHub();
}

function checkLogin() {
    const input = document.getElementById('admin-pass').value;
    if (input === ADMIN_PASS) {
        sessionStorage.setItem('admin_logged_in', 'true');
        showAdminHub();
    } else {
        document.getElementById('login-msg').innerText = "密碼錯誤";
        document.getElementById('login-msg').style.color = "red";
    }
}

window.showAllOrders = function (btnEl) {
    window.currentPrimaryView = 'all';
    window.currentDeliveryFilter = 'all';

    const board = document.getElementById('kanban-board');
    if (board) board.classList.remove('hidden');
    document.getElementById('inventory-section').classList.add('hidden');

    document.getElementById('page-title').innerHTML = '<i class="fas fa-list-check"></i> 全部訂單管理';
    applyFilter();
};

window.showWorkOrders = function (btnEl) {
    window.currentPrimaryView = 'work';

    const board = document.getElementById('kanban-board');
    if (board) board.classList.remove('hidden');
    document.getElementById('inventory-section').classList.add('hidden');

    document.getElementById('page-title').innerHTML = '<i class="fas fa-tools"></i> 今日生產工單';
    applyFilter();
};

window.showWarehouseShipment = function (btnEl) {
    window.currentPrimaryView = 'shipment';

    const board = document.getElementById('kanban-board');
    if (board) board.classList.remove('hidden');
    document.getElementById('inventory-section').classList.add('hidden');

    document.getElementById('page-title').innerHTML = '<i class="fas fa-shipping-fast"></i> 今日出貨';
    applyFilter();
};

window.showInventory = function (btnEl) {
    window.currentPrimaryView = 'inventory';

    const board = document.getElementById('kanban-board');
    if (board) board.classList.add('hidden');
    const invSection = document.getElementById('inventory-section');
    if (invSection) invSection.classList.remove('hidden');

    document.getElementById('page-title').innerHTML = '<i class="fas fa-warehouse"></i> 成品/配件 庫存管理';

    // Always show Hub when first entering
    backToInventoryHub();

    if (!window.allInventory) {
        fetchInventoryData();
    }
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

window.assignProjectIds = function() {
    if (!ordersData || ordersData.length === 0) return;
    // 只做顯示備援：S欄有值就用；沒有才用 timestamp 後4碼暫時顯示
    // 後端 v17 起，新訂單下單時就會寫入 S欄，這裡只是保護舊訂單顯示不爆掉
    ordersData.forEach(order => {
        if (!order.projectId) {
            const d = window.safeParseDate(order.timestamp);
            const dateKey = d.getFullYear().toString()
                + (d.getMonth() + 1).toString().padStart(2, '0')
                + d.getDate().toString().padStart(2, '0');
            const ts = String(order.timestamp || Date.now());
            const suffix = ts.slice(-4);
            order.projectId = `B${dateKey}-${suffix}`;
            // 注意：這裡不寫回 Sheets，避免競爭條件
            // 如果想永久固定，請直接在 Sheets S欄手動填入
        }
    });
};

async function fetchOrders() {
    // 預先載入庫存資訊，確保 renderDetailCards 能顯示 SKU (自動轉譯)
    if (!window.allInventory || window.allInventory.length === 0) {
        fetchInventoryData();
    }
    // ... rest of fetchOrders ...
    try {
        const res = await fetch(ADMIN_API_URL + "?action=getOrders&t=" + new Date().getTime());
        const json = await res.json();

        if (json.orders) {
            // Load saved statuses
            const savedStatuses = JSON.parse(localStorage.getItem('order_statuses') || '{}');

            // [跨機同步修正] 狀態標準推進順序（index 越大＝進度越前面）
            const STATUS_ORDER = ['unquoted', 'quoted', 'paid', 'cutting', 'inspection', 'picking', 'packing', 'shipping', 'dispatched', 'completed'];
            const _rank = s => STATUS_ORDER.indexOf(s);
            let _localDirty = false;

            ordersData = json.orders.map(order => {
                const key = String(order.timestamp);
                const backendStatus = order.status || '';
                const localStatus = savedStatuses[key];

                // 規則：以「進度較前面者」為準
                //  - 本機較前進（自己剛推、後端還沒同步）→ 保留本機，避免閃跳
                //  - 否則一律以後端為準（別台已推進 or 本機落後）→ 跨機同步、不再卡死
                if (localStatus && _rank(localStatus) > _rank(backendStatus)) {
                    order.status = localStatus;
                } else {
                    order.status = backendStatus || 'unquoted';
                    // 後端較新時，順手把過時的本機快取更新掉，避免它下次又蓋過後端
                    if (localStatus && localStatus !== order.status) {
                        savedStatuses[key] = order.status;
                        _localDirty = true;
                    }
                }
                return order;
            });

            if (_localDirty) {
                try { localStorage.setItem('order_statuses', JSON.stringify(savedStatuses)); } catch (e) { }
            }

            // [快取] 將最新資料存入 localStorage，讓下次可立即顯示
            try {
                localStorage.setItem('orders_cache', JSON.stringify(ordersData));
                localStorage.setItem('orders_cache_time', Date.now());
            } catch (e) { /* localStorage 空間不足時靜默失敗 */ }

            window.assignProjectIds(); // 計算全域專案流水號
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

    // Only render Kanban if we are actually in the "Orders" module (dashboard is visible)
    const dashboard = document.getElementById('dashboard');
    if (dashboard && dashboard.classList.contains('hidden')) {
        return; // We are in Hub, History, or Reports. Do not render Kanban.
    }

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
        // All Orders View (exclude completed)
        filtered = ordersData.filter(o => o.status !== 'completed');
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
    const board = document.getElementById('kanban-board');
    if (!board) return;

    // Determine Groups based on view
    let groups = [];
    if (window.currentPrimaryView === 'work') {
        groups = [
            {
                title: "廠務權責區 <span class='header-tag'>13:00對單切料</span>",
                cols: ['cutting'],
                headerStyle: "background: var(--accent-20);",
                actionBtn: `<button onclick="generateConsolidatedCuttingList()" class="btn-merge-cut">合併切料</button>`
            },
            {
                title: "倉儲包裝區 <span class='header-tag'>13:00-17:00對料 品檢 包裝</span>",
                cols: ['inspection', 'picking', 'packing'],
                headerStyle: "background: var(--accent-warehouse);"
            }
        ];
    } else if (window.currentPrimaryView === 'shipment') {
        groups = [
            {
                title: "倉儲出貨區 <span class='header-tag'>8:00-12:00 出昨日訂單</span>",
                cols: ['shipping', 'dispatched'],
                headerStyle: "background: var(--accent-40);"
            }
        ];
    } else {
        groups = [
            {
                title: "客服權責區 <span class='header-tag'>8:00-17:00 每日12:00收單</span>",
                cols: ['unquoted', 'quoted', 'paid'],
                headerStyle: "background: var(--accent-30);"
            },
            {
                title: "廠務權責區 <span class='header-tag'>13:00對單切料</span>",
                cols: ['cutting'],
                headerStyle: "background: var(--accent-20);",
                actionBtn: `<button onclick="generateConsolidatedCuttingList()" class="btn-merge-cut" style="font-size:0.8rem; padding:4px 8px;">合併切料</button>`
            },
            {
                title: "倉儲包裝區 <span class='header-tag'>13:00-17:00對料 品檢 包裝</span>",
                cols: ['inspection', 'picking', 'packing'],
                headerStyle: "background: var(--accent-warehouse);"
            },
            {
                title: "倉儲出貨區 <span class='header-tag'>8:00-12:00 出昨日訂單</span>",
                cols: ['shipping', 'dispatched'],
                headerStyle: "background: var(--accent-40);"
            }
        ];
    }

    // Helper to generate Column HTML
    const getColHtml = (statusKey) => {
        let label = STATUS_LABELS[statusKey] || statusKey;

        // Mobile sticky state: Check if this column should be expanded
        const isExpanded = window.expandedColumns.has(statusKey);
        // On desktop, we don't use 'collapsed' class at all (CSS handles display),
        // but adding it doesn't hurt as CSS only hides it on mobile.
        const collapsedClass = isExpanded ? '' : 'collapsed';

        return `
    <div class="kanban-column">
                <div class="column-header status-${statusKey} ${collapsedClass}">
                    <span>${label}</span>
                    <span class="count-badge" id="count-${statusKey}">0</span>
                </div>
                <div class="column-body ${collapsedClass}" id="col-${statusKey}"></div>
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
            <div class="group-title-wrapper">
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
            const displayId = order.projectId || '#';
            body.appendChild(createCard(order, displayId, status));
        }
    });

    for (let s in counts) {
        const badge = document.getElementById(`count-${s}`);
        if (badge) badge.innerText = counts[s];
    }

    // New: After rendering cards, ensure mobile accordion is initialized
    initMobileAccordion();
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
            let lenMatch = line.match(/\(L=([\d.]+)cm\)/);
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
                .replace(/\(L=[\d.]+cm\)/, '')
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
            let seriesColor = 'var(--accent-20)'; // Series 20 (Slate Blue)
            if (item.series === 30) seriesColor = 'var(--accent-30)'; // Series 30 (Warm Tea)
            if (item.series === 40) seriesColor = 'var(--accent-40)'; // Series 40 (Moss Green)

            return `
    <tr style="border-bottom:1px solid var(--border);">
                    <td style="padding:12px 8px; font-weight:bold; color:${seriesColor};">${item.series}系列</td>
                    <td style="padding:12px 8px;">${item.name}</td>
                    <td style="padding:12px 8px; font-weight:bold; color:var(--text);">${item.length * 10} mm</td>
                    <td style="padding:12px 8px; font-weight:bold; font-size:1.1em; color:var(--accent-30);">${item.qty} 支</td>
                    <td style="padding:12px 8px; font-size:0.8em; color:var(--ash-gray);">${item.orders.join(', ')}</td>
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
                    <h1 style="margin:0; font-size:1.8rem;">ALUMIBRO 鋁材兄弟 - 合併切料工單</h1>
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
        let summary = list.map(i => `${i.name} (${i.length * 10}mm)x${i.qty} `).join(' | ');
        reqSummaryList.innerText = summary || "選單中無待切鋁材";

        // 2. Render Parameter Rows for each unique model
        let uniqueModels = [...new Set(list.map(i => i.name))].sort();

        container.innerHTML = uniqueModels.map(model => {
            const item = list.find(i => i.name === model);
            const series = item ? item.series : 99;
            let seriesColor = '#4A5A6B';
            if (series === 20) seriesColor = '#6b8db0';
            if (series === 30) seriesColor = '#b08850';
            if (series === 40) seriesColor = '#5e8a5e';

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
                        if (isNaN(num) || num <= 0) return;
                        // [自我修復] >600(cm 不可能) 但 ÷10 ≤600 → 舊版誤存的 mm，還原成 cm（與主解析器一致）
                        if (num > 600 && (num / 10) <= 600) num = num / 10;
                        if (num > 600) return; // ÷10 後仍 >600，視為異常略過
                        parsedArr.push(num);
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
        const modelSeries = modelReqs[0] ? modelReqs[0].series : 99;
        let sColor = 'var(--accent-20)';
        if (modelSeries === 30) sColor = 'var(--accent-30)';
        if (modelSeries === 40) sColor = 'var(--accent-40)';

        html += `<h3 style="border-left:5px solid ${sColor}; padding-left:10px; margin-top:30px; color:${sColor}; font-weight:bold;">【${modelName}】 切割計畫 <span style="font-size:0.75em; color:var(--ash-gray); font-weight:normal;">(原料:${stockLen * 10} mm, 餘料:${offcuts.length}支)</span></h3>`;
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
            let bgColor = 'var(--accent-20)'; // Default Slate Blue (20)
            if (cut.series === 30) bgColor = 'var(--accent-30)'; // Warm Tea
            if (cut.series === 40) bgColor = 'var(--accent-40)'; // Moss Green

            cutsHtml += `
    <div class="cut-block" style="width:${widthPerc}%; background-color:${bgColor};" title="${cut.name} (${cut.length * 10}mm)">
        <span class="cut-len">切 ${cut.length * 10} mm</span>
                </div>
    `;
            // Kerf visual?
            let kerfPerc = (0.5 / originalLen) * 100;
            cutsHtml += `
    <div class="cut-kerf" style="width:${kerfPerc}%;" title="鋸路 5mm"></div>
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
        <div class="cut-remain ${typeClass}" style="width:${remainPerc}%;" title="剩餘 ${(remainLen * 10).toFixed(0)}mm">
            <span class="remain-len">${label} ${(remainLen * 10).toFixed(0)}</span>
                </div>
    `;
        }

        let label = isOffcut ? `餘料 #${idx + 1}` : `新料 #${idx + 1}`;
        let bgStyle = isOffcut ? 'background:#fdf6ed; border-color:#b08850;' : 'background:#f0f4f8; border-color:#6b8db0;';

        html += `
    <div class="cut-row" style="${bgStyle}">
                <div class="cut-label">${label} <span style="font-size:0.8em; color:#666;">(${originalLen * 10}mm)</span></div>
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
    let num = Math.round(parseFloat(String(val)));
    return "NT$ " + (isNaN(num) ? "0" : num);
}

// 根據訂單明細判斷公司配送車型 (同 script.js renderAnalysisAndManifest 邏輯)
function detectVehicleType(detailsStr) {
    if (!detailsStr) return null;
    const weightMap = {
        '2020型': 0.458, '2040型': 0.862, '2060型': 1.266, '2080型': 1.7,
        '3030輕型': 0.693, '3030重型': 1.07, '3060輕型': 1.218, '3060重型': 1.844,
        '6060輕型': 1.908, '6060重型': 2.763,
        '6060型': 2.45,
        '4040輕型': 1.298, '4040重型': 1.923, '4080輕型': 2.265, '4080重型': 3.505,
        '8080型': 5.2
    };
    let maxLen = 0;
    let totalWeight = 0;
    const lines = detailsStr.split(/\\n|\n/).filter(l => l.trim());
    lines.forEach(line => {
        if (!line.includes('鋁材') && !line.includes('鋁擠型') && !line.includes('型')) return;
        const lenMatch = line.match(/(?:L=|長度)(\d+(?:\.\d+)?)cm/);
        const qtyMatch = line.match(/\( x (\d+) \)/);
        const len = lenMatch ? parseFloat(lenMatch[1]) : 0;
        const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        if (len <= 0) return;
        if (len > maxLen) maxLen = len;
        // 找對應重量
        let wPerM = 0;
        for (const [key, w] of Object.entries(weightMap)) {
            if (line.includes(key)) { wPerM = w; break; }
        }
        if (wPerM === 0) wPerM = 1; // 未知型號預設 1kg/m
        totalWeight += wPerM * (len / 100) * qty;
    });
    if (maxLen === 0 && totalWeight === 0) {
        // 只有配件，沒有鋁材 → 小貨車就夠
        return '<span style="color:#27ae60;"><i class="fas fa-truck-pickup"></i> 小貨車</span>';
    }
    return (maxLen > 250 || totalWeight > 50)
        ? '<span style="color:#c0392b;"><i class="fas fa-truck-moving"></i> 大貨車</span>'
        : '<span style="color:#27ae60;"><i class="fas fa-truck-pickup"></i> 小貨車</span>';
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

// [New] Helper to trigger Gmail reply from Kanban card securely without inline HTML injection
window.triggerGmailReply = function (orderId) {
    let target = ordersData.find(o => String(o.timestamp) === String(orderId));
    if (!target) return;
    if (!target.email) {
        alert('此訂單沒有留下 Email 資訊。');
        return;
    }

    // Generate body on-the-fly to avoid syntax errors in HTML attributes
    let mailSubject = encodeURIComponent(`ALUMIBRO訂購報價回覆 - ${target.name}`);
    let rawBody = window.generateMailBody(target.name, target.total, target.shippingFee || 0, target.details);
    let mailBody = encodeURIComponent(rawBody);

    // Safety check for URL length to prevent HTTP 400 Error
    if (mailBody.length > 1800) {
        rawBody = window.generateMailBody(target.name, target.total, target.shippingFee || 0, target.details, true);
        mailBody = encodeURIComponent(rawBody);
    }

    window.openGmail(target.email, mailSubject, mailBody);

    // [New] Auto-Advance Logic: For S2S orders, jump directly to picking (skip confirmation per user request)
    let isStoreOrder = (target.address || "").includes("店到店");
    // [修正] 有鋁材的單不可自動跳撿料（仍需切料）
    let _hasAlu = (target.details || "").match(/鋁材|銘材|鋁擠型/);
    if (target.status === 'unquoted' && isStoreOrder && !_hasAlu) {
        // Auto-advance without confirm() to make it "Directly jump"
        window.advanceStatus(orderId, 'picking');
    }
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

    // Determine tag color based on status (synced with group header)
    // 功能區配色 (與 group-header / column-header 一致)
    // 客服區: unquoted / quoted / paid → 暖茶色
    // 工廠區: cutting → 板岩藍
    // 倉庫區: inspection / picking / packing → 奶茶咖啡
    // 出貨區: shipping / dispatched → 鼠尾草綠
    const TAG_COLORS = {
        'unquoted': 'var(--accent-30)',
        'quoted': 'var(--accent-30)',
        'paid': 'var(--accent-30)',
        'cutting': 'var(--accent-20)',
        'inspection': 'var(--accent-warehouse)',
        'picking': 'var(--accent-warehouse)',
        'packing': 'var(--accent-warehouse)',
        'shipping': 'var(--accent-40)',
        'dispatched': 'var(--accent-40)',
        'completed': 'var(--status-completed)'
    };
    const tagColor = TAG_COLORS[currentStatus] || 'var(--accent-mail)';
    const tagStyle = `style="background:${tagColor};color:#fff;"`;

    // 卡片左框顏色跟功能區大標籤一致
    el.style.borderLeft = `3px solid ${tagColor}`;

    let tag = "";
    let isSelfPickup = false;
    let isStore = false;

    if ((order.address || "").includes("宅配")) tag = `<span class="card-tag" ${tagStyle}>宅配</span>`;
    if ((order.address || "").includes("自取")) {
        tag = `<span class="card-tag" ${tagStyle}>自取</span>`;
        isSelfPickup = true;
    }
    // [Fix] Most robust Store-to-Store detection mapping using window.safeParsePrice
    let addrStr = (order.address || "");
    let s2sKeywords = ["店到店", "超商", "7-11", "全家", "[店到店]"];
    let hasS2SKeyword = s2sKeywords.some(k => addrStr.includes(k));
    let parsedShipFee = window.safeParsePrice(order.shippingFee);

    if (hasS2SKeyword) {
        tag = `<span class="card-tag" ${tagStyle}>店到店</span>`;
        isStore = true;
        isSelfPickup = false;
    }
    if (addrStr.includes("公司配送")) {
        const vt = detectVehicleType(order.details);
        const vtLabel = vt
            ? (vt.includes('大貨車') ? ' <i class="fas fa-truck-moving"></i>' : ' <i class="fas fa-truck-pickup"></i>')
            : '';
        tag = `<span class="card-tag" ${tagStyle}>公司配送${vtLabel}</span>`;
    }

    // [修正] 是否含鋁材 → 決定要不要走切料（與配送方式無關）。
    // 有鋁材一定要切料；只有配件才可跳過切料直接撿料。
    let _d = order.details || "";
    let hasProfiles = _d.includes('鋁材') || _d.includes('銘材') || _d.includes('鋁擠型');

    // Determine Next Step Logic
    let nextStatus = null;
    let prevStatus = null;

    // [Crucial Fix] For Store-to-Store orders at 'unquoted' or 'quoted', next step IS ALWAYS 'picking'
    // [修正] 但只有「沒有鋁材」的單才走這條捷徑；有鋁材一定要先切料。
    if (isStore && !hasProfiles && (currentStatus === 'unquoted' || currentStatus === 'quoted')) {
        nextStatus = 'picking';
    } else {
        let flow = STANDARD_FLOW;
        if (WORK_FLOW.includes(currentStatus)) flow = WORK_FLOW;
        let currIdx = flow.indexOf(currentStatus);
        if (currIdx !== -1) {
            if (currIdx < flow.length - 1) nextStatus = flow[currIdx + 1];
            if (currIdx > 0) prevStatus = flow[currIdx - 1];
        }
    }

    if (currentStatus === 'paid') {
        // [修正] 有鋁材 → 切料；只有配件 → 才跳過切料直接撿料（不再看配送方式）
        if (!hasProfiles) nextStatus = 'picking';
        else nextStatus = 'cutting';
    }

    if (currentStatus === 'packing') {
        nextStatus = 'shipping';
    }

    let nextBtnHtml = '';
    if (nextStatus) {
        let nextLabel = STATUS_LABELS[nextStatus];
        let btnText = nextLabel;

        // [Final Logic Enforcement] Ensure text and status are correct for S2S
        if (isStore && !hasProfiles && (currentStatus === 'unquoted' || currentStatus === 'quoted')) {
            nextStatus = 'picking';
            btnText = "開始撿貨 (店到店)";
        } else if (currentStatus === 'unquoted') {
            if (!isSelfPickup) {
                btnText = "輸入報價金額";
            } else {
                btnText = "已報價";
            }
        }

        if (currentStatus === 'paid') {
            if (nextStatus === 'cutting') btnText = "開始工單流程";
            if (nextStatus === 'picking') btnText = "開始撿貨 (入庫)";
        }
        if (currentStatus === 'packing' && nextStatus === 'shipping') btnText = "完成包裝 (移至待出貨)";

        let btnClass = 'btn-to-' + nextStatus;

        // Define Target Colors for Buttons (Morandi Variables)
        const STATUS_COLORS = {
            'quoted': 'var(--accent-30)',
            'paid': 'var(--accent-30)',
            'cutting': 'var(--accent-20)',
            'inspection': 'var(--accent-warehouse)',
            'picking': 'var(--accent-warehouse)',
            'packing': 'var(--accent-warehouse)',
            'shipping': 'var(--accent-40)',
            'dispatched': 'var(--accent-40)'
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

    let mailSubject = encodeURIComponent(`ALUMIBRO訂購報價回覆 - ${order.name}`);
    let rawBody = window.generateMailBody(order.name, order.total, order.shippingFee || 0, order.details);
    let mailBody = encodeURIComponent(rawBody);

    el.innerHTML = `
    <div class="card-header">
        <div class="card-meta">
            <span class="card-no" style="background:${tagColor}; color:#fff;">${index}</span>
        </div>
        ${tag}
    </div>
    <div class="card-body">
        <div class="card-title">${order.name}</div>
        <div class="card-main-content">
            <div class="card-contact">
                <div class="card-info"><i class="fas fa-phone-alt"></i> ${order.phone}</div>
                <div class="card-info email-info"><i class="far fa-envelope"></i> ${order.email || "無 Email"}</div>
            </div>
            <div class="card-price-container">
                <div class="card-price">
                    ${formatPrice(order.total)}
                    ${(currentStatus === 'unquoted' && !isSelfPickup && !isStore) ? '<span class="status-pending-hint">(待報價)</span>' : ''}
                    ${(order.shippingFee && order.shippingFee > 0) ? `<div class="shipping-fee-hint" style="color:#999; font-size:0.78rem;">(含運費 $${order.shippingFee})</div>` : ''}
                </div>
            </div>
        </div>
    </div>

    <div class="card-actions">
        ${prevBtnHtml}
        <button class="btn-card-action btn-gmail"
            style="background:${tagColor}; color:#fff;"
            onclick="event.stopPropagation(); window.triggerGmailReply('${order.timestamp}')">
            <i class="fas fa-envelope"></i> 回覆
        </button>
        ${nextBtnHtml}
    </div>
    `;
    // 強制回覆按鈕顏色跟功能區一致（覆蓋 CSS class 的 rose 預設）
    const gmailBtn = el.querySelector('.btn-gmail');
    if (gmailBtn) {
        gmailBtn.style.setProperty('background', tagColor, 'important');
        gmailBtn.style.setProperty('color', '#fff', 'important');
    }
    return el;
}

window.regressStatus = function (orderId, prevStatus) {
    let target = ordersData.find(o => o.timestamp === orderId);
    if (target) {
        // [Safety Guard] 待出貨/已出貨 = 配件扣帳點，一律不准退回（純看狀態，不靠 localStorage 記號）
        if (target.status === 'shipping' || target.status === 'dispatched') {
            alert("⚠️ 無法退回上一步！\n\n訂單已進入「待出貨／已出貨」，配件庫存已扣除。\n強制退回會造成庫存重複扣除。\n若確實需要退回，請聯繫管理員手動調整庫存。");
            return;
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

        // [跨機同步修正] 退回也要存回後端，否則新合併規則會讓退回失效、別台也看不到
        fetch(ADMIN_API_URL, {
            method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updateOrderPrice',
                orderId: orderId,
                newTotal: target.total || 0,
                shippingFee: target.shippingFee || 0,
                status: prevStatus,
                projectId: target.projectId
            })
        }).then(() => console.log(`Regress ${prevStatus} saved to backend`)).catch(() => { });

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

    // [Fix] Local status update should only happen after guards
    // But for S2S or Self-Pickup 'unquoted' jump, we handle it inside the specific block.

    // --- 1. Quoted Safety Check (Modal + Self-Pickup Skip) ---
    // [Fix] If nextStatus is already 'picking' (from S2S logic), skip this block
    if (target.status === 'unquoted' && nextStatus === 'quoted') {
        const addr = (target.address || "").toLowerCase();
        let isS2S = addr.includes("店到店") || addr.includes("[店到店]");
        // [修正] 有鋁材的單不可走店到店捷徑跳撿料（仍需切料）
        let _hasAlu = (target.details || "").match(/鋁材|銘材|鋁擠型/);

        // Smart Skip: Self-Pickup implies 0 shipping. 
        // Note: For S2S, we usually want to jump to 'picking', not 'quoted'. 
        // If we somehow get here for S2S and nextStatus is 'quoted', redirect to 'picking' logic.
        if (isS2S && !_hasAlu) {
            nextStatus = 'picking';
            target.status = 'picking'; // Update locally for S2S jump
        } else if (addr.includes("自取") || addr.includes("[自取]")) {
            // Self-Pickup remains 'quoted' (price confirmed)
            let currentTotal = parseInt(String(target.total).replace(/[^0-9]/g, '') || 0);
            target.total = currentTotal;
            target.shippingFee = 0;
            target.status = nextStatus; // Update locally

            // ... rest of logic ...
            if (target.email) {
                let mailSubject = encodeURIComponent(`ALUMIBRO訂購報價回覆 - ${target.name} `);
                let rawBody = window.generateMailBody(target.name, target.total, 0, target.details);
                let mailBody = encodeURIComponent(rawBody);
                window.openGmail(target.email, mailSubject, mailBody);
            }

            // Persist
            fetch(ADMIN_API_URL, {
                method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action: 'updateOrderPrice', orderId: orderId, newTotal: target.total, shippingFee: 0, status: nextStatus })
            });

            applyFilter();
            window.lastActiveOrderId = orderId;
            closeModal();
            return;
        } else {
            // Show Modal for Shipping Fee (Default Delivery)
            showPriceModal(target, nextStatus);
            return;
        }
    }

    // --- 1.5. Quoted -> Paid Safety Check (Payment Confirmation) ---
    if (target.status === 'quoted' && nextStatus === 'paid') {
        if (!confirm(`⚠️ 確認收到款項了嗎？\n\n訂單：${target.name} \n應收金額：${formatPrice(target.total)} \n\n按下確定後將轉入「已付款(待處理)」階段。`)) {
            return; // Block transition if user cancels
        }
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
                window.persistOrderStatus(orderId, nextStatus, target); // [修正] 存狀態+POST後端

                applyFilter();
                window.lastActiveOrderId = orderId;
                closeModal(); // [Fix] Ensure modal closes
            }
            return;
        }

        const lines = target.details.split('\n'); // Assuming 'lines' should come from target.details

        let currentContextSeries = 99;

        lines.forEach(line => {
            if (!line.trim()) return;

            // 辨識當前行的系列 (先移除 SKU 再偵測，防止 [M4-333] 等 SKU 干擾系列判斷)
            let series = window.detectSeries(window.removeSKU ? window.removeSKU(line) : line);
            
            const isProfile = line.includes('【鋁材】') || line.includes('鋁材') || line.includes('鋁擠型') || line.includes('銘材') || line.match(/\d{4}型/);

            // 更新上下文
            if (isProfile) {
                if (series !== 99) currentContextSeries = series;
                return; // 鋁材不參與配件扣帳
            }

            // 配件繼承上下文
            if (series === 99) {
                series = currentContextSeries;
            }

            // 1. 解析原始數量
            let qty = 1;
            const qMatch = line.match(/\( x (\d+) \)/);
            if (qMatch) qty = parseInt(qMatch[1]);

            let itemName = line.replace(/^【.*?】\s*/, '').replace(/\s*--\s*\$[0-9]+/g, '').replace(/\( x \d+ \)/, '').trim();
            if (!itemName) return;

            // 3. 嘗試獲取 SKU 或識別身分
            const skuMatch = line.match(/\[(.*?)\]/);
            let resolved = { sku: '', finalKey: itemName, cleanBase: itemName, series: series };
            
            if (skuMatch) {
                resolved.sku = skuMatch[1].trim();
                resolved.finalKey = '[' + resolved.sku + ']';

                // SKU 反推系列
                let skuImpliedSeries = 99;
                if (resolved.sku.includes('M4')) skuImpliedSeries = 20;
                else if (resolved.sku.includes('M6')) skuImpliedSeries = 30;
                else if (resolved.sku.includes('M8')) skuImpliedSeries = 40;

                // [修復] 交叉驗證：若 SKU 隱含系列與上下文系列衝突，以上下文為準重新查找
                if (skuImpliedSeries !== 99 && series !== 99 && skuImpliedSeries !== series) {
                    console.warn(`[SKU Mismatch] SKU=${resolved.sku} 隱含 ${skuImpliedSeries}系，但上下文是 ${series}系，以上下文為準重新解析`);
                    resolved.series = series;
                    const reResolved = window.resolveItemInfo(window.removeSKU ? window.removeSKU(itemName) : itemName, series);
                    if (reResolved.sku) {
                        resolved.sku = reResolved.sku;
                        resolved.finalKey = '[' + resolved.sku + ']';
                    }
                } else {
                    resolved.series = skuImpliedSeries !== 99 ? skuImpliedSeries : series;
                }
            } else if (window.allInventory && window.allInventory.length > 0) {
                resolved = window.resolveItemInfo(itemName, series);
            } else {
                resolved.finalKey = window.getInventoryKey(itemName, series);
            }

            const key = resolved.finalKey;
            const finalSeries = resolved.series;
            if (key.includes('平頭螺絲')) return;

            // 4. [修復] 扣帳策略：
            if (resolved.sku) {
                const current = deductionMap.get(key) || { qty: 0, series: finalSeries };
                const currentQty = typeof current === 'object' ? current.qty : current;
                deductionMap.set(key, { qty: currentQty + qty, series: finalSeries });
            } else {
                const hasBundle = itemName.includes('(含') || itemName.includes('（含');
                if (hasBundle) {
                    window.extractAndAddScrewNutsToMap(itemName, qty, finalSeries, deductionMap);
                } else {
                    const current = deductionMap.get(key) || { qty: 0, series: finalSeries };
                    const currentQty = typeof current === 'object' ? current.qty : current;
                    deductionMap.set(key, { qty: currentQty + qty, series: finalSeries });
                }
            }
        });

        const finalDeductList = Array.from(deductionMap.entries()).map(([name, data]) => {
            // data 可能是數量(number) 或者是含 series 的物件
            if (typeof data === 'object') {
                return { name, qty: data.qty, series: data.series };
            }
            return { name, qty: data, series: 99 }; // Fallback
        });

        console.log('📦 最終扣庫存清單:', finalDeductList);

        // Only deduct if accessories exist
        if (finalDeductList.length > 0) {
            if (!window.isProcessing) {
                window.isProcessing = true;

                // --- Visual Loading Feedback Start ---
                const finishBtn = document.getElementById('btn-finish-check');
                let originalBtnHtml = '';
                if (finishBtn) {
                    originalBtnHtml = finishBtn.innerHTML;
                    finishBtn.disabled = true;
                    finishBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在計算並扣除配件庫存...';
                    finishBtn.style.opacity = '0.7';
                }
                const cards = document.querySelectorAll('.kanban-card');
                cards.forEach(c => c.style.pointerEvents = 'none'); // Prevent other clicks
                document.body.style.cursor = 'wait';
                // --- Visual Loading Feedback End ---

                deductInventory(finalDeductList).then(success => {
                    window.isProcessing = false;

                    // --- Visual Loading Feedback Revert ---
                    if (finishBtn) {
                        finishBtn.disabled = false;
                        finishBtn.innerHTML = originalBtnHtml;
                        finishBtn.style.opacity = '1';
                    }
                    cards.forEach(c => c.style.pointerEvents = 'auto');
                    document.body.style.cursor = 'default';
                    // --- Visual Loading Feedback Revert End ---

                    if (success) {
                        // Mark as deducted
                        localStorage.setItem(`deducted_acc_${orderId}`, 'true');

                        target.status = nextStatus;
                        window.persistOrderStatus(orderId, nextStatus, target); // [修正] 存狀態+POST，避免重整跳回
                        applyFilter();
                        window.lastActiveOrderId = orderId;
                        alert("✅ 配件庫存已扣除，訂單移至待出貨。");
                        window.closeModal(); // Auto close if inside modal
                    } else {
                        // Allow force proceed?
                        if (confirm("⚠️ 配件扣除失敗 (可能庫存不足或名稱不符)。\n是否強制移至待出貨？")) {
                            target.status = nextStatus;
                            window.persistOrderStatus(orderId, nextStatus, target); // [修正] 存狀態+POST
                            applyFilter();
                            window.lastActiveOrderId = orderId;
                            window.closeModal();
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
        let subject = encodeURIComponent(`ALUMIBRO 鋁材兄弟 - 出貨通知(${target.name})`);

        // Format details for email
        let formattedDetails = (target.details || "").replace(/\\n/g, '\n').replace(/\n/g, '\n');
        let detailsClip = formattedDetails;
        let note = target.note ? target.note : "無";

        let bodyText = `您好，ALUMIBRO 鋁材兄弟通知您\n\n您的訂單已出貨囉！\n\n訂單明細摘要：\n${detailsClip} \n\n出貨單號 / 備註：${note} \n\n如有任何問題，歡迎隨時與我們聯絡！`;
        let body = encodeURIComponent(bodyText);

        if (body.length > 1800) {
            let cutoff = formattedDetails.lastIndexOf('\n', 1200);
            if (cutoff === -1) cutoff = 1200;
            detailsClip = formattedDetails.substring(0, cutoff);
            bodyText = `您好，ALUMIBRO 鋁材兄弟通知您\n\n您的訂單已出貨囉！\n\n訂單明細摘要：\n${detailsClip} \n\n出貨單號 / 備註：${note} \n\n如有任何問題，歡迎隨時與我們聯絡！`;
            body = encodeURIComponent(bodyText);
        }

    }

    // [Fix] Update status locally for ALL other confirmed transitions
    target.status = nextStatus;

    // [Fix] Persist ALL status transitions to backend universally
    fetch(ADMIN_API_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
            action: 'updateOrderPrice',
            orderId: orderId,
            newTotal: target.total || 0,
            shippingFee: target.shippingFee || 0,
            status: nextStatus,
            projectId: target.projectId
        })
    }).then(() => console.log(`Status ${nextStatus} saved to backend`)).catch(console.error);

    applyFilter();
    window.lastActiveOrderId = orderId;
    closeModal(); // [Fix] Default close after status change
};

window.toggleCheck = function (el) {
    el.classList.toggle('checked');
    updateCheckProgress();
};

window.updateCheckProgress = function () {
    const order = window.currentOrderForPrint;
    const currentStatus = order ? order.status : '';

    let total = document.querySelectorAll('.detail-card').length;
    let checked = document.querySelectorAll('.detail-card.checked').length;
    let label = document.getElementById('progress-label');
    if (label) {
        if (currentStatus === 'packing') {
            label.innerText = '免勾選 (直接確認)';
        } else {
            label.innerText = `已核對 ${checked} / ${total}`;
        }
    }

    let pill = document.getElementById('progress-pill');
    if (pill) {
        if (currentStatus === 'packing') {
            pill.classList.add('complete');
        } else if (checked === total && total > 0) {
            pill.classList.add('complete');
        } else {
            pill.classList.remove('complete');
        }
    }

    let btn = document.getElementById('btn-finish-check');
    if (btn) {
        if (currentStatus === 'packing') {
            btn.classList.add('active');
        } else if (checked === total) {
            // Even if total is 0 (e.g. no aluminum in inspection), allow moving to next step
            btn.classList.add('active');
            if (currentStatus === 'inspection') btn.innerHTML = '<i class="fas fa-check-circle"></i> 確認無誤 → 前進至撿貨單';
            else if (currentStatus === 'picking') btn.innerHTML = '<i class="fas fa-check-circle"></i> 確認無誤 → 前進至包裝';
        } else {
            btn.classList.remove('active');
            btn.innerHTML = '尚有項目未核對 (請點擊上方核對)';
        }
    }
};

window.viewOrder = function (order) {
    // [Fix] Support calling with ID (String) for History module
    if (typeof order === 'string' || typeof order === 'number') {
        let found = ordersData.find(o => String(o.timestamp) === String(order));
        if (!found) { alert("找不到該筆訂單"); return; }
        order = found;
    }

    const modal = document.getElementById('modal');
    const body = document.getElementById('modal-body');

    let dateStr = order.timestamp;
    try { dateStr = window.safeParseDate(order.timestamp).toLocaleString(); } catch (e) { }
    let note = order.note ? order.note : "無";
    let address = order.address || "無";

    // [Fix] Clean up shipping placeholders for ALL order statuses to avoid duplication
    // (Unquoted orders also get cleaned now, because the tag/header already shows the method)
    address = address.replace(/\(運費待報價\)/g, '').replace(/\[宅配.*?\]/g, '').replace(/\[自取\]/g, '').replace(/\[店到店.*?\]/g, '').replace(/\[公司配送.*?\]/g, '').trim();

    // Strip out the old "(運費已列入)" and "(運費待報價)" text from the note
    note = note.replace(/\(?運費已列入\)?/g, '').replace(/\(?運費待報價\)?/g, '').trim();
    if (!note) note = "無";

    // Add explicit shipping fee info if it has been quoted
    if (order.status !== 'unquoted' && typeof order.shippingFee !== 'undefined') {
        const feeNote = `<span style="color:#888;">[運費已核定：NT$ ${order.shippingFee}]</span>`;
        if (note === '無') {
            note = feeNote; // 取代「無」，不同時顯示
        } else {
            note += `<br>${feeNote}`; // 備註有內容才追加
        }
    }

    window.currentOrderForPrint = order;

    body.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:0; font-size:0.84rem; margin-bottom:10px;">

            <div style="display:flex; justify-content:flex-end; margin-bottom:6px;">
                <button onclick="window.closeModal()" class="btn-close-inline">✖ 關閉</button>
            </div>

            <!-- 每一欄：label 左固定寬，value 右自動 -->
            <div style="display:flex; align-items:baseline; padding:4px 0; border-bottom:1px solid #f2f2f2;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">訂單時間</span>
                <span style="color:#333;">${dateStr}</span>
            </div>

            <div style="display:flex; align-items:baseline; padding:4px 0; border-bottom:1px solid #f2f2f2;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">客戶姓名</span>
                <span style="color:#333;">${order.name}</span>
            </div>

            <div style="display:flex; align-items:baseline; padding:4px 0; border-bottom:1px solid #f2f2f2;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">聯絡電話</span>
                <span style="color:#333;">${order.phone}</span>
            </div>

            <div style="display:flex; align-items:baseline; padding:4px 0; border-bottom:1px solid #f2f2f2;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">配送方式</span>
                <span style="color:var(--accent-delivery);">${(() => {
            let addr = order.address || "";
            if (addr.includes("宅配")) return "宅配寄送";
            if (addr.includes("自取")) return "客戶自取";
            if (addr.includes("店到店")) return "店到店";
            if (addr.includes("公司配送")) {
                const vt = detectVehicleType(order.details);
                return "公司配送" + (vt ? " · " + vt : "");
            }
            return "一般貨運";
        })()}</span>
            </div>

            <div style="display:flex; align-items:flex-start; padding:4px 0; border-bottom:1px solid #f2f2f2;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">配送地址</span>
                <span style="color:#333; word-break:break-all;">${address}</span>
            </div>

            ${note !== '無' || note ? `
            <div style="display:flex; align-items:flex-start; padding:4px 0; border-bottom:1px solid #f2f2f2;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">備註</span>
                <span style="color:#333;">${note}</span>
            </div>` : ''}

            <div style="display:flex; align-items:baseline; padding:5px 0;">
                <span style="color:#aaa; font-size:0.76rem; width:72px; flex-shrink:0;">訂單總額</span>
                <span style="color:var(--accent-delivery); font-size:1.05rem; font-weight:400;">${formatPrice(order.total)}</span>
            </div>
            
            ${(order.sysTotal || order.outsourcePrice || order.assemblyFee || order.discountAmount || order.shippingFee !== undefined) ? `
            <div style="margin-top: 10px; padding: 12px; background: #fafafa; border-radius: 6px; border: 1px solid #eee;">
                <div style="font-size: 0.85rem; font-weight: bold; color: #333; margin-bottom: 8px; border-bottom: 2px solid #ddd; padding-bottom: 4px;">報價明細拆解</div>
                
                ${order.sysTotal ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding: 3px 0;"><span>鋁材與配件小計:</span> <span>NT$ ${order.sysTotal}</span></div>` : ''}
                ${order.outsourcePrice ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding: 3px 0;"><span>外購品/客製品項:</span> <span>NT$ ${order.outsourcePrice}</span></div>` : ''}
                ${order.assemblyFee ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding: 3px 0;"><span>加工與組裝費:</span> <span>NT$ ${order.assemblyFee}</span></div>` : ''}
                ${order.discountAmount ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--dusty-rose); font-weight:bold; padding: 3px 0;"><span>折扣優惠:</span> <span>-NT$ ${order.discountAmount}</span></div>` : ''}
                ${order.shippingFee !== undefined && order.shippingFee !== "" ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding: 3px 0;"><span>運費金額:</span> <span>NT$ ${order.shippingFee}</span></div>` : ''}
                ${(order.taxType === '外加 5%' || order.taxType === 'exclusive') ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#666; padding: 3px 0;"><span>稅金 (外加 5%):</span> <span>NT$ ${order.taxAmount || 0}</span></div>` : ''}
                ${(order.taxType === 'inclusive') ? `<div style="display:flex; justify-content:space-between; font-size:0.8rem; color:#999; padding: 3px 0;"><span>(內含稅金):</span> <span>(NT$ ${order.taxAmount || 0})</span></div>` : ''}
                
                <div style="border-top: 1px dashed #ccc; margin-top: 8px; padding-top: 8px; display:flex; justify-content:space-between; align-items:baseline; font-weight:bold; color:#333;">
                    <span style="font-size:0.85rem;">總計金額:</span> 
                    <span style="font-size:1.05rem; color:var(--accent-delivery);">NT$ ${order.total} <span style="font-size:0.75em; color:#888; font-weight:normal;">${(order.taxType === '外加 5%' || order.taxType === 'exclusive') ? '(含 5% 外加稅)' : (order.taxType === 'inclusive' ? '(含稅價)' : '')}</span></span>
                </div>
            </div>` : ''}
        </div>

        <hr style="border:0; border-top:1px dashed #ddd; margin: 8px 0;">
        
        <div class="detail-group">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                 <div class="detail-label" style="margin-bottom:0;">訂購明細核對</div>
                 <button class="btn-print" onclick="printOrder()"><i class="fas fa-print"></i> 列印撿貨單 (A4)</button>
            </div>
            
            <div style="background:#f9f9f9; padding:5px; border-radius:8px;">
                <div class="checklist-progress-bar" style="${['inspection', 'picking'].includes(order.status) ? '' : 'display:none;'}">
                    <div class="progress-text" style="font-size:0.9em;">核對進度</div>
                    <div id="progress-pill" class="progress-pill">
                        <span id="progress-label">0/0</span>
                    </div>
                </div>
                
                <div class="detail-pre" style="padding:10px 0;">
                    ${renderDetailCards(order.details, order.status)}
                </div>
                
                <div style="margin-top: 15px; padding: 12px; background: #fafafa; border: 1px solid #eee; border-radius: 8px; font-size: 0.95em;">
                    <div style="display:flex; justify-content: space-between; align-items: center;">
                        <span style="color:#777; font-weight:500;">庫存連動狀態：</span>
                        <div style="display:flex; gap:12px;">
                            ${window.isProfileDeducted(order) ?
            '<span style="color:#27ae60; font-weight:bold;"><i class="fas fa-check-circle"></i> 鋁材已扣除</span>' :
            '<span style="color:#999;"><i class="far fa-circle"></i> 鋁材未處理</span>'}
                            ${localStorage.getItem('deducted_acc_' + order.timestamp) ?
            '<span style="color:#27ae60; font-weight:bold;"><i class="fas fa-check-circle"></i> 配件已扣除</span>' :
            '<span style="color:#999;"><i class="far fa-circle"></i> 配件未處理</span>'}
                        </div>
                    </div>
                </div>

                <!-- Explicit Close Buttons -->
                <div style="display:flex; gap:10px; margin-top:10px;">
                     <button onclick="window.closeModal()" style="flex:1; padding:12px; background:#e74c3c; border:none; border-radius:6px; color:#fff; cursor:pointer;">
                        ✖ 關閉視窗
                     </button>
                     ${order.status === 'cutting' ? `
                     <button id="btn-finish-check" class="btn-finish-check active" onclick="finishCheck()" style="flex:2; margin-top:0; background:var(--accent-warehouse); color:#fff;">
                         ✓ 切割完成 → 前進至品檢
                     </button>
                     ` : order.status === 'inspection' ? `
                     <button id="btn-finish-check" class="btn-finish-check" onclick="finishCheck()" style="flex:2; margin-top:0; background:var(--accent-warehouse); color:#fff;">
                         ✓ 核對完成 → 前進至撿貨單
                     </button>
                     ` : order.status === 'picking' ? `
                     <button id="btn-finish-check" class="btn-finish-check" onclick="finishCheck()" style="flex:2; margin-top:0; background:var(--accent-warehouse); color:#fff;">
                         ✓ 核對完成 window.detectSeries = function (name) {

                      </button>
                      ` : order.status === 'packing' ? `
                     <button id="btn-finish-check" class="btn-finish-check active" onclick="finishCheck()" style="flex:2; margin-top:0; background:var(--accent-40); color:#fff;">
                         ✓ 確認無誤 → 前進至待出貨
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
    if (!name) return 99;
    const cleanName = name.toUpperCase();
    
    // 1. [最強 B 欄對位] 根據鋁材型號前兩碼判定
    if (cleanName.includes('2020') || cleanName.includes('2040') || cleanName.includes('2060') || cleanName.includes('2080')) return 20;
    if (cleanName.includes('3030') || cleanName.includes('3060') || cleanName.includes('3090') || cleanName.includes('6060')) return 30;
    if (cleanName.includes('4040') || cleanName.includes('4080') || cleanName.includes('8080')) return 40;

    // 2. 根據 SKU 關鍵字判定 (HR-0001~0002 是 20系, 0003~0008 是 30系, 0009~0012 是 40系)
    if (cleanName.includes('HR-0001') || cleanName.includes('HR-0002')) return 20;
    if (cleanName.includes('HR-0003') || cleanName.includes('HR-0004') || cleanName.includes('HR-0005') || cleanName.includes('HR-0006') || cleanName.includes('HR-0007') || cleanName.includes('HR-0008')) return 30;
    if (cleanName.includes('HR-0009') || cleanName.includes('HR-0010') || cleanName.includes('HR-0011') || cleanName.includes('HR-0012')) return 40;

    // 3. 配件關鍵字 (M4->20, M6->30, M8->40)
    if (cleanName.includes('M3') || cleanName.includes('M4') || cleanName.includes('M5')) {
        if (cleanName.includes('30用') || cleanName.includes('30系列')) return 30;
        if (cleanName.includes('40用') || cleanName.includes('40系列')) return 40;
        return 20;
    }
    if (cleanName.includes('M6')) return 30;
    if (cleanName.includes('M8')) return 40;

    if (cleanName.includes('20系列')) return 20;
    if (cleanName.includes('30系列') || cleanName.includes('60系列')) return 30;
    if (cleanName.includes('40系列') || cleanName.includes('80系列')) return 40;
    
    return 99;
};

// ==========================================
// CORE DATA NORMALIZATION (核心資料標準化)
// ==========================================

// 徹底移除品名中任何位置的 SKU 標籤 [XXX]
window.removeSKU = function (name) {
    if (!name) return "";
    return name.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
};

// 統一的項目辨識與 SKU 查找函數
window.resolveItemInfo = function (rawName, series) {
    if (!rawName) return { sku: '', finalKey: '', cleanBase: '' };
    
    // Extract original SKU before stripping it, as a reliable fallback
    const originalSkuMatch = window.parseSKU(rawName);

    const cleanBase = window.removeSKU(rawName)
        .replace(/\s*--\s*\$[0-9,]+/g, '')
        .replace(/\( x \d+ \)/g, '')
        .replace(/\(含[^)]+\)/g, '')
        .replace(/（含[^）]+）/g, '')
        .trim();

    let sku = originalSkuMatch || '';
    let finalKey = cleanBase;

    // [Fix] Handle SKU and Series mismatch (e.g. M4-333 in a 30 series order should be M6-333)
    if (sku && series && series !== 99) {
        let skuImpliedSeries = 99;
        if (sku.includes('M4')) skuImpliedSeries = 20;
        else if (sku.includes('M6')) skuImpliedSeries = 30;
        else if (sku.includes('M8')) skuImpliedSeries = 40;
        
        if (skuImpliedSeries !== 99 && skuImpliedSeries !== series) {
            sku = ''; // Reset SKU to force regeneration based on correct series
        }
    }

    // Hardcoded fallbacks for very common items if inventory match fails
    if (!sku) {
        const n = cleanBase.toUpperCase();
        if (n.includes('M4六角螺絲') || n.includes('M4螺絲')) sku = 'A20-1M4';
        else if (n.includes('M4螺母')) sku = 'A20-0M4';
        else if (n.includes('M5六角螺絲')) sku = (series === 30) ? 'A30-1M5' : 'A20-1M5';
        else if (n.includes('M5螺母')) sku = (series === 30) ? 'A30-0M5' : 'A20-0M5';
        else if (n.includes('M6六角螺絲') || n.includes('M6螺絲')) sku = 'A30-1M6';
        else if (n.includes('M6螺母')) sku = 'A30-0M6';
        else if (n.includes('M8六角螺絲') || n.includes('M8螺絲')) {
            if (n.includes('包') || n.includes('10枚')) sku = 'M8-IOOO';
            else sku = 'A40-1M8';
        }
        else if (n.includes('M8螺母')) sku = 'A40-0M8';

        // [修復] 系列對應配件 SKU 備用查找（當庫存資料未載入時使用）
        if (!sku && series !== 99) {
            const cn = cleanBase;
            if (cn.includes('三角連結塊')) {
                if (series === 20) sku = 'M4-333';
                else if (series === 30) sku = 'M6-333';
                else if (series === 40) sku = 'M8-333';
            } else if (cn.includes('平板連結片')) {
                if (series === 20) sku = 'M4-L';
                else if (series === 30) sku = 'M6-L';
                else if (series === 40) sku = 'M8-L';
            } else if (cn.includes('靜音輪') || cn.includes('腳杯固定器')) {
                if (series === 30) sku = 'M6-FEET';
                else if (series === 40) sku = 'M8-FEET';
            } else if (cn.includes('六角板手')) {
                if (series === 20) sku = 'M4-6';
                else if (series === 30) sku = 'M6-6';
                else if (series === 40) sku = 'M8-6';
            }
        }
    }

    if (sku) {
        finalKey = `[${sku}]`;
    }

    let resolvedSeries = series;

    if (window.allInventory && window.allInventory.length > 0) {
        // 嘗試多種組合查找
        const normalized = window.normalizeScrewName(cleanBase);
        const searchKeys = [
            sku ? `${cleanBase} [${sku}]` : null,
            sku ? `${normalized} [${sku}]` : null,
            series !== 99 ? `${series}-${cleanBase}` : null,
            series !== 99 ? `${series}-${normalized}` : null,
            cleanBase,
            normalized
        ].filter(Boolean);

        for (const sKey of searchKeys) {
            // [重要] 傳入 series 協助定位正確的產品類型
            const match = window.fuzzyMatchInventoryKey(sKey, window.allInventory, series);
            if (match) {
                const pname = (match.name || match.品項名稱 || "").toString();
                const invSku = window.parseSKU(pname);
                
                // [反向修正] 從庫存中識別正確的系列
                const invSeriesStr = (match.series || match.產品類型 || "").toString();
                if (invSeriesStr.includes('20')) resolvedSeries = 20;
                else if (invSeriesStr.includes('30') || invSeriesStr.includes('6060')) resolvedSeries = 30;
                else if (invSeriesStr.includes('40') || invSeriesStr.includes('80')) resolvedSeries = 40;

                if (invSku) {
                    sku = invSku;
                    finalKey = `[${sku}]`;
                    break;
                } else if (originalSkuMatch) {
                    sku = originalSkuMatch;
                    finalKey = `[${sku}]`;
                    break;
                }
            }
        }
    }
    return { sku, finalKey, cleanBase, series: resolvedSeries };
};

window.normalizeScrewName = function (name) {
    if (!name) return "";
    let n = name.trim();
    
    // [修復] 同義詞處理：統一將華司轉為墊司
    n = n.replace(/華司/g, '墊司');
    
    // [修復] 螺絲包識別：如果是包裝類項目，不要轉化為單顆螺絲名，否則會誤導 SKU 匹配
    if (n.includes('包') || n.includes('10枚')) {
        return n;
    }

    // 擴大匹配：只要包含螺絲/螺母等關鍵字，就轉為資料庫標準型
    if (n.includes('螺絲')) n = n.replace(/M(\d+).*/, 'M$1六角螺絲');
    if (n.includes('螺母') || n.includes('螺帽')) n = n.replace(/M(\d+).*/, 'M$1螺母');
    return n;
};

window.convertToInventoryKey = function (name, series) {
    // 為了相容性保留此函數，但內部改用 resolveItemInfo
    return window.resolveItemInfo(name, series).cleanBase;
};

window.isScrewOrNut = function (name) {
    const n = name.toLowerCase();
    // 排除組合配件包本體（舊格式：含螺絲，新格式：xx枚/包）
    if (n.includes('(含') || n.includes('（含') || n.includes('(組') || n.includes('（組')) return false;
    if (n.includes('/包') || n.includes('枚/') || n.includes('包裝')) return false; // 新格式：螺絲組合包
    return n.includes('螺絲') || n.includes('螺母') || n.includes('螺帽') || n.includes('滑塊') || n.includes('彈片');
};

window.extractAndAddScrewNutsToMap = function (name, qty, mainSeries, totalsMap) {
    const match = name.match(/\(含([^)]+)\)/) || name.match(/（含([^）]+）)/);
    if (!match) return;
    const parts = match[1].split(/[,，]/);
    parts.forEach(part => {
        const compMatch = part.trim().match(/^(.+?)x(\d+)$/);
        if (compMatch) {
            let compName = compMatch[1].trim();
            const compQtyValue = parseInt(compMatch[2]) * qty;
            if (compName.includes('平頭螺絲')) return;

            // 零件偵測：若產品名含系列則優先
            const series = (compName.includes('20')) ? 20 :
                (compName.includes('30')) ? 30 :
                    (compName.includes('40')) ? 40 : mainSeries;

            // 使用統一的解析邏輯，確保與主循環 key 一致
            const info = window.resolveItemInfo(compName, series);
            const current = totalsMap.get(info.finalKey) || 0;
            totalsMap.set(info.finalKey, current + compQtyValue);
        }
    });
}

// ==========================================
// BACKGROUND 3D CITYSCAPE LOGIC
// ==========================================

let sceneInitialized = false;
let animationFrameId;
let isThreeJsPaused = false;
let threeJsAnimateFunc;

function initThreeJsScene() {
    if (sceneInitialized) return;

    // Check if Three.js is loaded
    if (typeof THREE === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
        script.onload = () => buildScene();
        document.head.appendChild(script);
    } else {
        buildScene();
    }
}

function buildScene() {
    const container = document.getElementById('three-canvas-container');
    if (!container) return;

    let decimalTime = 12.0; // Share time across functions

    // 1. Setup Scene & Orthographic Camera (for perfect Isometric view)
    const scene = new THREE.Scene();

    const aspect = window.innerWidth / window.innerHeight;
    let d = 1200; // Unified scale for all devices
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 15000);

    // Position camera for strict isometric projection (30 degrees down, 45 degrees rotated)
    camera.position.set(2000, 2000, 2000);
    camera.lookAt(0, 0, 0); // Explicitly look at center origin

    // 2. Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 3. Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 1000, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    // Initial position, will be dynamically overriden by updateSky()
    dirLight.position.set(2000, 3000, 2000);
    dirLight.castShadow = true;
    dirLight.shadow.camera.left = -3000;
    dirLight.shadow.camera.right = 3000;
    dirLight.shadow.camera.top = 3000;
    dirLight.shadow.camera.bottom = -3000;
    dirLight.shadow.camera.far = 10000;
    dirLight.shadow.mapSize.width = 4096; // High-res shadows
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.bias = -0.0005; // Prevent shadow acne
    scene.add(dirLight);

    // 4. Base Plane (River / Water) - Deep stylized ocean
    const riverGeometry = new THREE.PlaneGeometry(20000, 20000);
    const riverMaterial = new THREE.MeshStandardMaterial({
        color: 0xb2d8d8, // Light Morandi Blue-Green
        roughness: 0.1,  // Lower roughness for smoother water reflection
        metalness: 0.6,  // Higher metalness for glass-like reflection
        transparent: true, // Enable transparency
        opacity: 0.85     // Slightly see-through
    });
    const riverPlane = new THREE.Mesh(riverGeometry, riverMaterial);
    riverPlane.rotation.x = -Math.PI / 2;
    riverPlane.position.y = -20;
    riverPlane.receiveShadow = true;
    scene.add(riverPlane);

    // Banks - Sleek dark landscaping instead of bright toy green -> Changed to White per user request
    const bankMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, // White
        roughness: 0.8,
        metalness: 0.1
    });

    // Left Bank
    const leftBank = new THREE.Mesh(new THREE.PlaneGeometry(10000, 20000), bankMaterial);
    leftBank.rotation.x = -Math.PI / 2;
    leftBank.position.set(-5500, -10, 0); // Inner edge at -500
    leftBank.receiveShadow = true;
    scene.add(leftBank);

    // Right Bank
    const rightBank = new THREE.Mesh(new THREE.PlaneGeometry(10000, 20000), bankMaterial);
    rightBank.rotation.x = -Math.PI / 2;
    rightBank.position.set(5500, -10, 0); // Inner edge at 500
    rightBank.receiveShadow = true;
    scene.add(rightBank);

    // --- 4.1 River Embankments (Levees) ---
    const leveeGeom = new THREE.BoxGeometry(40, 40, 20000);
    const leveeMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });

    const leftLevee = new THREE.Mesh(leveeGeom, leveeMat);
    leftLevee.position.set(-500, 10, 0); // Center at y=10 (from -10 to 30)
    leftLevee.receiveShadow = true;
    leftLevee.castShadow = true;
    scene.add(leftLevee);

    const rightLevee = new THREE.Mesh(leveeGeom, leveeMat);
    rightLevee.position.set(500, 10, 0);
    rightLevee.receiveShadow = true;
    rightLevee.castShadow = true;
    scene.add(rightLevee);

    // 5. The Diagonal Bridge
    // Standard isometric bridge usually crosses from back-left to front-right or similar.
    // To match typical diagonal composition:
    const bridgeGroup = new THREE.Group();

    // Main deck
    const deckGeometry = new THREE.BoxGeometry(450, 30, 20000); // Thicker and much longer
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x7f8c8d }); // concrete
    const bridgeDeck = new THREE.Mesh(deckGeometry, deckMaterial);
    bridgeDeck.position.y = 150;
    bridgeDeck.receiveShadow = true;
    bridgeDeck.castShadow = true;
    bridgeGroup.add(bridgeDeck);

    // Road surface
    const roadGeometry = new THREE.BoxGeometry(400, 5, 20000);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x2d3436 }); // asphalt
    const roadSurface = new THREE.Mesh(roadGeometry, roadMaterial);
    roadSurface.position.y = 165;
    bridgeGroup.add(roadSurface);

    // Bridge Pillars
    const pillarGeom = new THREE.CylinderGeometry(60, 60, 200, 32);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x95a5a6 });
    for (let z = -8000; z <= 8000; z += 1200) {
        const p1 = new THREE.Mesh(pillarGeom, pillarMat);
        p1.position.set(-150, 50, z);
        p1.castShadow = true;
        bridgeGroup.add(p1);

        const p2 = new THREE.Mesh(pillarGeom, pillarMat);
        p2.position.set(150, 50, z);
        p2.castShadow = true;
        bridgeGroup.add(p2);
    }

    // Rotate the bridge perpendicularly (90 degrees) across the scene
    bridgeGroup.rotation.y = Math.PI / 2;
    scene.add(bridgeGroup);

    // 6. City Buildings on the banks
    const cityGroup = new THREE.Group();
    const buildingMatDay = new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.7 }); // Neutral gray base

    // Create a procedural window texture for night lights - focused, discrete windows
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#f1c40f';
    for (let y = 16; y < 128; y += 32) {
        for (let x = 16; x < 128; x += 32) {
            if (Math.random() > 0.4) ctx.fillRect(x, y, 12, 16);
        }
    }
    const windowTexture = new THREE.CanvasTexture(canvas);
    windowTexture.wrapS = THREE.RepeatWrapping;
    windowTexture.wrapT = THREE.RepeatWrapping;

    const buildingMatNight = new THREE.MeshStandardMaterial({
        color: 0x050510, // Near black body
        emissive: 0xffffff,
        emissiveMap: windowTexture,
        emissiveIntensity: 1.0 // Balanced intensity
    });

    const buildingMatNightPlain = new THREE.MeshStandardMaterial({
        color: 0x050510,
        emissive: 0x000000,
        emissiveMap: null
    });

    const generateRowHouses = (centerX) => {
        const step = 110; // Fixed spacing for "connected" look
        const zRange = 8500;

        for (let z = -zRange; z <= zRange; z += step) {
            // Avoid bridge area (Reduced from 800 to 300 for tighter fit)
            if (Math.abs(z) < 300) continue;

            const width = 100; // Uniform width for row effect
            const depth = 110 + Math.random() * 40;
            const height = 60 + Math.random() * 100;

            const geometry = new THREE.BoxGeometry(width, height, depth);

            // Create a material array to ensure the roof (top face) has no windows
            // BoxGeometry groups: 0,1 (+/-X), 2,3 (+/-Y), 4,5 (+/-Z)
            // Top face is index 2. Bottom face is index 3.
            // Create side material with windows
            const bMatNightSide = buildingMatNight.clone();
            bMatNightSide.emissiveMap = windowTexture.clone();
            bMatNightSide.emissiveMap.repeat.set(1, Math.max(1, Math.floor(height / 60)));
            bMatNightSide.emissiveMap.needsUpdate = true;
            bMatNightSide.emissiveIntensity = 0.7;

            // Day materials array with slightly randomized gray
            const shade = 0.5 + Math.random() * 0.4; // Range from 0.5 to 0.9 gray
            const customDayMat = buildingMatDay.clone();
            customDayMat.color.setRGB(shade, shade, shade);
            const dayMaterials = [customDayMat, customDayMat, customDayMat, customDayMat, customDayMat, customDayMat];

            // Night materials array: index 2 (Top) and 3 (Bottom) MUST use buildingMatNightPlain
            const nightMaterials = [bMatNightSide, bMatNightSide, buildingMatNightPlain, buildingMatNightPlain, bMatNightSide, bMatNightSide];

            const bldg = new THREE.Mesh(geometry, dayMaterials);
            bldg.position.set(centerX, height / 2 - 10, z);
            bldg.castShadow = true;
            bldg.receiveShadow = true;

            bldg.userData = { isBuilding: true, dayMat: dayMaterials, nightMat: nightMaterials };
            cityGroup.add(bldg);
        }
    };

    // Function to generate a cluster of buildings with strict collision avoidance
    const generateCluster = (centerX, centerZ, count, spread) => {
        let placed = 0;
        let attempts = 0;

        while (placed < count && attempts < count * 8) {
            attempts++;
            const width = 80 + Math.random() * 120;
            const depth = 80 + Math.random() * 120;

            const bx = centerX + (Math.random() - 0.5) * spread;
            const bz = centerZ + (Math.random() - 0.5) * spread;

            // --- 1. River & Bank Road & Row House Exclusion ---
            // Reduced to 1250 to start right after row houses (which end at +/-1225)
            if (Math.abs(bx) < 1250) continue;

            // --- 2. Bridge Exclusion Zone ---
            // Bridge width is 450, so Z ranges from -225 to 225. 
            // Reduced from 600 to 250 for a snug fit.
            if (Math.abs(bz) < 250) continue;

            // --- 3. Dynamic Height based on "Roadside" proximity ---
            const nearRiver = Math.abs(bx) < 1850;
            const nearBridge = Math.abs(bz) < 1000;
            const isRoadside = nearRiver || nearBridge;

            let height;
            if (isRoadside) {
                height = 60 + Math.random() * 150;
            } else {
                height = 150 + Math.random() * 600 + (Math.random() > 0.85 ? 500 : 0);
            }

            const geometry = new THREE.BoxGeometry(width, height, depth);

            // Night materials array: index 2 (Top) and 3 (Bottom) use buildingMatNightPlain
            const bMatNightSide = buildingMatNight.clone();
            bMatNightSide.emissiveMap = windowTexture.clone();
            const repeatX = Math.max(1, Math.floor(width / 80));
            const repeatY = Math.max(1, Math.floor(height / 80));
            bMatNightSide.emissiveMap.repeat.set(repeatX, repeatY);
            bMatNightSide.emissiveMap.needsUpdate = true;
            bMatNightSide.emissiveIntensity = isRoadside ? 0.8 : 1.0;

            const shade = 0.4 + Math.random() * 0.5; // Wider range for background clusters
            const customDayMat = buildingMatDay.clone();
            customDayMat.color.setRGB(shade, shade, shade);
            const dayMaterials = [customDayMat, customDayMat, customDayMat, customDayMat, customDayMat, customDayMat];
            const nightMaterials = [bMatNightSide, bMatNightSide, buildingMatNightPlain, buildingMatNightPlain, bMatNightSide, bMatNightSide];

            const bldg = new THREE.Mesh(geometry, dayMaterials);

            bldg.position.set(bx, height / 2 - 10, bz);
            bldg.castShadow = true;
            bldg.receiveShadow = true;

            bldg.userData = { isBuilding: true, dayMat: dayMaterials, nightMat: nightMaterials };
            cityGroup.add(bldg);
            placed++;
        }
    };

    // First row: High-density row houses (Row house first row)
    // Road edge is at +/- 1125. Houses (width 100) at +/- 1175 span 1125-1225.
    generateRowHouses(-1175); // Left Bank
    generateRowHouses(1175);  // Right Bank

    // Background clusters (Quality over quantity) - Increased density
    generateCluster(3500, -1000, 180, 4500);
    generateCluster(-3500, 1500, 120, 4500);

    scene.add(cityGroup);

    // --- 6.1 Street Light System ---
    const streetLights = [];
    const lightMatOff = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const lightMatOn = new THREE.MeshStandardMaterial({
        color: 0xffffaa,
        emissive: 0xffffaa,
        emissiveIntensity: 2.0
    });

    // --- 6.1.0 Radial Gradient Texture for Soft Street Lights ---
    const lightCanvas = document.createElement('canvas');
    lightCanvas.width = 128;
    lightCanvas.height = 128;
    const lctx = lightCanvas.getContext('2d');
    const gradient = lctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255, 255, 170, 0.8)');   // Center: Softer
    gradient.addColorStop(0.4, 'rgba(255, 255, 170, 0.3)'); // Mid: More transparent
    gradient.addColorStop(1, 'rgba(255, 255, 170, 0)');     // Edge: Fully faded
    lctx.fillStyle = gradient;
    lctx.fillRect(0, 0, 128, 128);
    const lightPoolTexture = new THREE.CanvasTexture(lightCanvas);

    function createStreetLight(parent, x, y, z, rotationY = 0) {
        const group = new THREE.Group();

        // Pole
        const poleGeom = new THREE.CylinderGeometry(3, 5, 70, 8);
        const pole = new THREE.Mesh(poleGeom, lightMatOff);
        pole.position.y = 35;
        group.add(pole);

        // Arm
        const armGeom = new THREE.BoxGeometry(30, 3, 3);
        const arm = new THREE.Mesh(armGeom, lightMatOff);
        arm.position.set(12, 68, 0);
        group.add(arm);

        // Lamp Head
        const headGeom = new THREE.BoxGeometry(12, 5, 10);
        const head = new THREE.Mesh(headGeom, lightMatOff);
        head.position.set(25, 66, 0);
        group.add(head);

        // Actual Light Glow (Bulb)
        const glowGeom = new THREE.SphereGeometry(8, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.6 });
        const glow = new THREE.Mesh(glowGeom, glowMat);
        glow.position.set(25, 62, 0);
        glow.visible = false;
        group.add(glow);

        // Ground Projection (Soft Light Pool)
        const projGeom = new THREE.PlaneGeometry(500, 500);
        const projMat = new THREE.MeshBasicMaterial({
            map: lightPoolTexture,
            transparent: true,
            opacity: 0.2, // Reduced for transparency as requested
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const projection = new THREE.Mesh(projGeom, projMat);
        projection.rotation.x = -Math.PI / 2;

        // Position it so the center of the gradient is slightly ahead of the pole
        const isBridge = (parent === bridgeGroup);
        const roadY = isBridge ? 3.0 : 1.2;
        projection.position.set(100, roadY, 0); // Offset center to simulate direction
        projection.visible = false;
        group.add(projection);

        group.position.set(x, y, z);
        group.rotation.y = rotationY;
        group.userData = { isStreetLight: true, head: head, glow: glow, projection: projection };

        parent.add(group);
        streetLights.push(group);
    }

    // Place lights on Bridge (Added to bridgeGroup)
    // Bridge surface is at Y=165 (deck top)
    for (let z = -9000; z <= 9000; z += 1200) {
        // Local coordinates within bridgeGroup
        // +X points one way, -X points other. Width is 450.
        // Rotation 0 means arm points to local +X. Rotation PI means points to local -X.
        createStreetLight(bridgeGroup, -210, 165, z, 0);      // Points towards center from left
        createStreetLight(bridgeGroup, 210, 165, z, Math.PI); // Points towards center from right
    }

    // Place lights on Bank Roads (Added to scene)
    for (let z = -9500; z <= 9500; z += 1500) {
        // Left Bank Road (X=-825): Place closer to road edge
        createStreetLight(scene, -1000, -10, z, 0);
        // Right Bank Road (X=825): Place closer to road edge
        createStreetLight(scene, 1000, -10, z, Math.PI);
    }

    // --- 6.2 Tree System (Lush Morandi Forest) ---
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8b7d6b }); // Muted Brown
    const treeLeavesMat = new THREE.MeshStandardMaterial({ color: 0x8ca38c }); // Sage Green
    const treeLeavesDarkMat = new THREE.MeshStandardMaterial({ color: 0x7a9a7a }); // Darker Sage (variation)

    function createTree(x, y, z, scale) {
        const s = scale || 1.0;
        const group = new THREE.Group();

        // Trunk (2x base size, scaled further by parameter)
        const trunkGeom = new THREE.CylinderGeometry(4 * s, 8 * s, 50 * s, 8);
        const trunk = new THREE.Mesh(trunkGeom, treeTrunkMat);
        trunk.position.y = 25 * s;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        group.add(trunk);

        // Leaves - Round Sphere canopy (2x base size, scaled further)
        const leavesGeom = new THREE.SphereGeometry(30 * s, 8, 6);
        const leavesMat = Math.random() > 0.5 ? treeLeavesMat : treeLeavesDarkMat;
        const leaves = new THREE.Mesh(leavesGeom, leavesMat);
        leaves.position.y = 65 * s;
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        group.add(leaves);

        // Optional secondary canopy for fuller look
        if (s > 0.8 && Math.random() > 0.4) {
            const leaves2Geom = new THREE.SphereGeometry(22 * s, 8, 6);
            const leaves2 = new THREE.Mesh(leaves2Geom, treeLeavesMat);
            leaves2.position.set(15 * s, 55 * s, 10 * s);
            leaves2.castShadow = true;
            group.add(leaves2);
        }

        group.position.set(x, y, z);
        scene.add(group);
    }

    // Place dense trees ON the levees - Row 1 (X = +/- 500, Y = 30 on top of levee)
    for (let z = -9000; z <= 9000; z += 150) {
        // Avoid bridge area
        if (Math.abs(z) < 350) continue;

        // High density: 85% chance per position
        if (Math.random() > 0.15) {
            const offsetX = (Math.random() - 0.5) * 20;
            const scale = 0.9 + Math.random() * 0.4;
            createTree(-500 + offsetX, 30, z + (Math.random() - 0.5) * 60, scale);
        }
        if (Math.random() > 0.15) {
            const offsetX = (Math.random() - 0.5) * 20;
            const scale = 0.9 + Math.random() * 0.4;
            createTree(500 + offsetX, 30, z + (Math.random() - 0.5) * 60, scale);
        }
    }

    // Place dense trees ON the levees - Row 2 (slight offset for depth)
    for (let z = -9000; z <= 9000; z += 200) {
        if (Math.abs(z) < 350) continue;

        if (Math.random() > 0.25) {
            const offsetX = (Math.random() - 0.5) * 25;
            const scale = 0.7 + Math.random() * 0.5;
            createTree(-500 + offsetX, 30, z + (Math.random() - 0.5) * 80, scale);
        }
        if (Math.random() > 0.25) {
            const offsetX = (Math.random() - 0.5) * 25;
            const scale = 0.7 + Math.random() * 0.5;
            createTree(500 + offsetX, 30, z + (Math.random() - 0.5) * 80, scale);
        }
    }

    // Place trees along row houses (behind the houses, X = +/- 1250)
    for (let z = -8500; z <= 8500; z += 250) {
        if (Math.abs(z) < 350) continue;

        if (Math.random() > 0.3) {
            const offsetX = (Math.random() - 0.5) * 30;
            const scale = 0.7 + Math.random() * 0.5;
            createTree(-1250 + offsetX, -10, z + (Math.random() - 0.5) * 80, scale);
        }
        if (Math.random() > 0.3) {
            const offsetX = (Math.random() - 0.5) * 30;
            const scale = 0.7 + Math.random() * 0.5;
            createTree(1250 + offsetX, -10, z + (Math.random() - 0.5) * 80, scale);
        }
    }

    // Place trees scattered around city clusters - 200 total
    for (let i = 0; i < 200; i++) {
        const side = Math.random() > 0.5 ? 1 : -1;
        const x = (1500 + Math.random() * 3000) * side;
        const z = (Math.random() - 0.5) * 17000;
        if (Math.abs(z) < 500) continue;
        const scale = 0.6 + Math.random() * 0.6;
        createTree(x, -10, z, scale);
    }

    // 7. Animated Traffic on the bridge
    const trafficGroup = new THREE.Group();
    const particleCount = 80; // Reduced traffic density by 60%
    const cars = [];

    // Factory for advanced car models with dual lights & glow
    function createCar(isForward, isBridge = false) {
        const carGroup = new THREE.Group();
        carGroup.userData.tailLights = [];

        // Body
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(16, 12, 35),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        carGroup.add(body);

        // Light & Glow Helper
        const isBraking = Math.random() < 0.2;
        const addLight = (x, z, color, isFront) => {
            // Core light point
            const light = new THREE.Mesh(
                new THREE.SphereGeometry(2, 8, 8),
                new THREE.MeshBasicMaterial({ color: color })
            );
            light.position.set(x, 0, z);
            carGroup.add(light);

            // Subtle Flare/Glow
            const isBrakeLight = !isFront && isBraking;
            const glowSize = isFront ? 10 : (isBrakeLight ? 10 : 6);
            const glowOpacity = isFront ? 0.5 : (isBrakeLight ? 0.6 : 0.3);

            const glow = new THREE.Mesh(
                new THREE.SphereGeometry(glowSize, 16, 16),
                new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: glowOpacity })
            );
            glow.position.set(x, 0, z);
            carGroup.add(glow);

            if (!isFront) {
                carGroup.userData.tailLights.push(glow);
            }

            // Headlight Projection (on the road surface)
            if (isFront) {
                const projGeom = new THREE.PlaneGeometry(12, 120);
                const projMat = new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.15,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false // Prevent Z-fighting
                });
                const projection = new THREE.Mesh(projGeom, projMat);
                projection.rotation.x = -Math.PI / 2;

                // Position projection in front of the car
                const projZ = isForward ? (z - 65) : (z + 65);
                // ROBUST HEIGHT MAPPING:
                // Bridge road center is at y=165, top surface is at 167.5. Car center at y=172.
                // Bank road top is at y=-8. Car center at y=5.
                const verticalOffset = isBridge ? -3.0 : -12.5;
                projection.position.set(x, verticalOffset, projZ);

                // Ensure it's rendered on top
                projection.renderOrder = 10;
                carGroup.add(projection);
            }
        };

        // If Forward (towards -z): Front is at -17.5, Back is at +17.5
        // If Backward (towards +z): Front is at +17.5, Back is at -17.5
        const frontZ = isForward ? -17.5 : 17.5;
        const backZ = isForward ? 17.5 : -17.5;
        const frontColor = 0xe0f7fa; // White
        const backColor = 0xff4757;  // Red

        addLight(5, frontZ, frontColor, true);
        addLight(-5, frontZ, frontColor, true);
        addLight(5, backZ, backColor, false);
        addLight(-5, backZ, backColor, false);

        return carGroup;
    }

    for (let i = 0; i < particleCount; i++) {
        const laneType = i % 4;
        const isForward = (laneType < 2);
        const isFast = (laneType === 0 || laneType === 2);

        const car = createCar(isForward, true); // Bridge
        const zPos = (Math.random() - 0.5) * 20000;

        let xPos;
        if (laneType === 0) xPos = 120;
        else if (laneType === 1) xPos = 40;
        else if (laneType === 2) xPos = -120;
        else xPos = -40;

        car.position.set(xPos, 172, zPos);

        const maxSpeed = isFast ? (1.5 + Math.random() * 1.0) : (0.5 + Math.random() * 0.5);
        car.userData = {
            ...car.userData,
            maxSpeed: maxSpeed,
            speed: isForward ? maxSpeed : -maxSpeed,
            isForward: isForward,
            laneId: `bridge_${laneType}`
        };
        cars.push(car);
        trafficGroup.add(car);
    }

    // Attach traffic to bridge group so it rotates with it
    bridgeGroup.add(trafficGroup);

    // 7.1. Left Bank Road & Traffic
    const leftBankRoadGroup = new THREE.Group();
    // Asphalt surface for 4 lanes
    const lbRoadGeom = new THREE.PlaneGeometry(600, 20000);
    const lbRoadMat = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Darker asphalt
    const lbRoad = new THREE.Mesh(lbRoadGeom, lbRoadMat);
    lbRoad.rotation.x = -Math.PI / 2;
    lbRoad.position.set(-825, -8, 0); // Under the lanes
    lbRoad.receiveShadow = true;
    leftBankRoadGroup.add(lbRoad);

    // Subtle lane markings
    const markingGeom = new THREE.PlaneGeometry(2, 20000);
    const markingMat = new THREE.MeshBasicMaterial({ color: 0x444444 });
    [-675, -825, -975].forEach(markX => {
        const mark = new THREE.Mesh(markingGeom, markingMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(markX, -7.5, 0);
        leftBankRoadGroup.add(mark);
    });
    scene.add(leftBankRoadGroup);

    const leftBankTrafficGroup = new THREE.Group();
    const leftBankCarsCount = 40;
    for (let i = 0; i < leftBankCarsCount; i++) {
        const laneType = i % 4; // 0: Bkwd Fast, 1: Bkwd Slow, 2: Fwd Fast, 3: Fwd Slow
        const isForward = (laneType >= 2);
        const isFast = (laneType === 0 || laneType === 2);

        const car = createCar(isForward, false); // Banks
        const zPos = (Math.random() - 0.5) * 20000;

        // Left Bank lanes
        let xPos;
        if (laneType === 0) xPos = -600;
        else if (laneType === 1) xPos = -750;
        else if (laneType === 2) xPos = -900;
        else xPos = -1050;

        car.position.set(xPos, 5, zPos);

        const maxSpeed = isFast ? (2.0 + Math.random() * 1.5) : (0.8 + Math.random() * 0.7);
        car.userData = {
            ...car.userData,
            maxSpeed: maxSpeed,
            speed: isForward ? maxSpeed : -maxSpeed,
            isForward: isForward,
            laneId: `left_${laneType}`
        };
        cars.push(car);
        leftBankTrafficGroup.add(car);
    }
    scene.add(leftBankTrafficGroup);

    // 7.2. Right Bank Road & Traffic
    const rightBankRoadGroup = new THREE.Group();
    const rbRoadGeom = new THREE.PlaneGeometry(600, 20000);
    const rbRoadMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const rbRoad = new THREE.Mesh(rbRoadGeom, rbRoadMat);
    rbRoad.rotation.x = -Math.PI / 2;
    rbRoad.position.set(825, -8, 0);
    rbRoad.receiveShadow = true;
    rightBankRoadGroup.add(rbRoad);

    [-675, -825, -975].forEach(markX => { // Relative offsets or absolute? Let's use absolute for rb
    });
    // Reuse lane markings logic for Right Bank
    [675, 825, 975].forEach(markX => {
        const mark = new THREE.Mesh(markingGeom, markingMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(markX, -7.5, 0);
        rightBankRoadGroup.add(mark);
    });
    scene.add(rightBankRoadGroup);

    const rightBankTrafficGroup = new THREE.Group();
    const rightBankCarsCount = 40;
    for (let i = 0; i < rightBankCarsCount; i++) {
        const laneType = i % 4; // 0: Fwd Fast, 1: Fwd Slow, 2: Bkwd Fast, 3: Bkwd Slow
        const isForward = (laneType < 2);
        const isFast = (laneType === 0 || laneType === 2);

        const car = createCar(isForward, false); // Banks
        const zPos = (Math.random() - 0.5) * 20000;

        // Right Bank lanes
        let xPos;
        if (laneType === 0) xPos = 600;
        else if (laneType === 1) xPos = 750;
        else if (laneType === 2) xPos = 900;
        else xPos = 1050;

        car.position.set(xPos, 5, zPos);

        const maxSpeed = isFast ? (2.0 + Math.random() * 1.5) : (0.8 + Math.random() * 0.7);
        car.userData = {
            ...car.userData,
            maxSpeed: maxSpeed,
            speed: isForward ? maxSpeed : -maxSpeed,
            isForward: isForward,
            laneId: `right_${laneType}`
        };
        cars.push(car);
        rightBankTrafficGroup.add(car);
    }
    scene.add(rightBankTrafficGroup);

    // --- 8. Add Physical Sun & Moon ---
    const sunGeom = new THREE.SphereGeometry(60, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    scene.add(sunMesh);

    // Add a glow/halo to sun
    const sunGlowGeom = new THREE.SphereGeometry(100, 32, 32);
    const sunGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.3 });
    const sunGlow = new THREE.Mesh(sunGlowGeom, sunGlowMat);
    sunMesh.add(sunGlow);

    const moonGeom = new THREE.SphereGeometry(40, 32, 32);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xccddee });
    const moonMesh = new THREE.Mesh(moonGeom, moonMat);
    scene.add(moonMesh);

    // Day/Night sky colors setup based on time (Moved here to avoid Temporal Dead Zone on lights)
    // Now with 24-hour Sun/Moon positioning
    const updateSky = () => {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        decimalTime = hour + minute / 60;

        let skyColor = new THREE.Color(0x87CEEB); // Default day
        let isNight = false;

        // --- 1. Calculate Sun/Moon Angle Based on 24-Hour Cycle ---
        // Let's assume Sunrise at 6:00 (0 deg), Noon at 12:00 (90 deg), Sunset at 18:00 (180 deg)
        // Night from 18:00 to 6:00 will be the "Moon" arcing across the sky.

        let orbitProgress = 0; // 0 to 1 across the sky hemisphere
        let lightColorHex = 0xffffff;

        if (decimalTime >= 6 && decimalTime < 18) {
            // Daytime orbit (6 to 18) -> 12 hours
            orbitProgress = (decimalTime - 6) / 12;
        } else {
            // Nighttime orbit (18 to 6) -> 12 hours
            isNight = true;
            if (decimalTime >= 18) {
                orbitProgress = (decimalTime - 18) / 12;
            } else {
                orbitProgress = (decimalTime + 6) / 12;
            }
        }

        // Map progress (0 to 1) to an angle (0 to PI)
        const angle = orbitProgress * Math.PI;

        // Radius of light orbit (how high the light source is)
        const radius = 4000;

        // Calculate X and Y positions. Z can be slightly offset for isometric depth
        const lightX = Math.cos(angle) * -radius; // Moves from Left to Right
        const lightY = Math.sin(angle) * radius;  // Arcs upwards and then downwards
        const lightZ = 2000; // Constant depth offset so shadows fall diagonally

        const finalPos = new THREE.Vector3(lightX, Math.max(lightY, 200), lightZ);
        dirLight.position.copy(finalPos);

        // Update Sun/Moon Mesh positions
        if (!isNight) {
            sunMesh.position.copy(finalPos);
            sunMesh.visible = true;
            moonMesh.visible = false;
        } else {
            moonMesh.position.copy(finalPos);
            moonMesh.visible = true;
            sunMesh.visible = false;
        }

        // --- 2. Time-of-Day Atmospherics ---
        if (decimalTime >= 6 && decimalTime < 16) {
            skyColor.setHex(0x9bd1f9);
            lightColorHex = 0xffffff;
            dirLight.intensity = 1.2;
            hemiLight.intensity = 0.6;
            hemiLight.groundColor.setHex(0x94a3b8);
        } else if (decimalTime >= 16 && decimalTime < 18.5) {
            skyColor.setHex(0xff7e5f);
            lightColorHex = 0xffddaa;
            dirLight.intensity = 0.8;
            hemiLight.intensity = 0.4;
            hemiLight.groundColor.setHex(0x221111);
        } else if (decimalTime >= 5 && decimalTime < 6) {
            skyColor.setHex(0xa8c0ff);
            lightColorHex = 0xccddff;
            dirLight.intensity = 0.6;
            hemiLight.intensity = 0.4;
            hemiLight.groundColor.setHex(0x111122);
        } else {
            skyColor.setHex(0x050814);
            lightColorHex = 0x7788aa;
            dirLight.intensity = 0.3;
            hemiLight.intensity = 0.15;
            hemiLight.groundColor.setHex(0x000000);
            isNight = true;
        }

        // Absolute Transparency Override
        scene.background = null;
        scene.fog = null;
        dirLight.color.setHex(lightColorHex);

        return isNight;
    };

    // 8. Animation Loop & Resize
    const animate = () => {
        if (isThreeJsPaused) return; // 暫停時不執行後續渲染
        animationFrameId = requestAnimationFrame(animate);

        // Update time of day
        const isNight = updateSky();

        // Toggle building materials based on night/day
        cityGroup.children.forEach(child => {
            if (child.userData.isBuilding) {
                child.material = isNight ? child.userData.nightMat : child.userData.dayMat;
            }
        });

        // Toggle street lights
        streetLights.forEach(light => {
            light.userData.glow.visible = isNight;
            light.userData.projection.visible = isNight;
            light.userData.head.material = isNight ? lightMatOn : lightMatOff;
        });

        // 1. Group cars by lane for distance calculations
        const lanes = {};
        cars.forEach(car => {
            if (!lanes[car.userData.laneId]) lanes[car.userData.laneId] = [];
            lanes[car.userData.laneId].push(car);
        });

        // 2. Process each lane for collision avoidance
        Object.keys(lanes).forEach(laneId => {
            const laneCars = lanes[laneId];
            const isForward = laneCars[0].userData.isForward;

            // Sort by current movement progress (Z position)
            // Forward (isForward=true): moving towards smaller Z (negative speed)
            // Backward (isForward=false): moving towards larger Z (positive speed)
            laneCars.sort((a, b) => isForward ? (a.position.z - b.position.z) : (b.position.z - a.position.z));

            for (let i = 0; i < laneCars.length; i++) {
                const car = laneCars[i];

                const leader = laneCars[i - 1]; // The car in front

                let targetSpeed = car.userData.maxSpeed;

                if (leader) {
                    // Correcting the distance calculation:
                    // If isForward (moving towards -Z), leader has SMALLER Z than follower.
                    // If !isForward (moving towards +Z), leader has LARGER Z than follower.
                    const distance = isForward ? (car.position.z - leader.position.z) : (leader.position.z - car.position.z);

                    // Account for wrapping with modulo
                    const normalizedDist = (distance + 20000) % 20000;

                    if (normalizedDist < 400) {
                        // Slow down as we get closer
                        const comfortGap = 350;
                        const minGap = 100;
                        const gapFactor = Math.max(0, (normalizedDist - minGap) / (comfortGap - minGap));
                        targetSpeed = Math.min(car.userData.maxSpeed, (leader.userData.speed || leader.userData.maxSpeed) * gapFactor);
                    }
                }

                // Smoothly accelerate/decelerate
                const accelRate = 0.05;
                const decelRate = 0.15; // Faster braking
                const currentSpeed = car.userData.speed;
                const speedDiff = targetSpeed - currentSpeed;

                if (speedDiff > 0) {
                    car.userData.speed = Math.min(targetSpeed, currentSpeed + accelRate);
                } else if (speedDiff < 0) {
                    car.userData.speed = Math.max(targetSpeed, currentSpeed - decelRate);
                }

                // 3. Dynamic Braking Visuals (Tail Lights)
                // Enhanced for sunset and night
                const isBraking = currentSpeed - targetSpeed > 0.01;
                const decelerationRatio = 1.0 - (Math.abs(car.userData.speed || 0) / (car.userData.maxSpeed || 1));
                const brakeIntensity = isBraking ? Math.max(0, Math.min(1, (decelerationRatio + 0.5))) : 0;

                if (car.userData.tailLights) {
                    car.userData.tailLights.forEach(glow => {
                        const showLight = (decimalTime >= 16 || decimalTime < 6);
                        glow.visible = showLight;
                        if (showLight) {
                            glow.scale.setScalar(1 + brakeIntensity * 1.5);
                            glow.material.opacity = 0.3 + (brakeIntensity * 0.7);
                            // Brighten color when braking
                            glow.material.color.setHex(isBraking ? 0xff0000 : 0xff4757);
                        }
                    });
                }

                // 4. Move the car
                car.position.z -= isForward ? car.userData.speed : -car.userData.speed;

                // Reset position if reaching end of bounds
                const bounds = 10000;
                if (isForward && car.position.z < -bounds) car.position.z = bounds;
                if (!isForward && car.position.z > bounds) car.position.z = -bounds;
            }
        });

        renderer.render(scene, camera);
    };

    const handleResize = () => {
        const aspect = window.innerWidth / window.innerHeight;
        d = 1200; // Uniform scale for both desktop and mobile
        camera.left = -d * aspect;
        camera.right = d * aspect;
        camera.top = d;
        camera.bottom = -d;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Initial sky update
    updateSky();

    animate();
    threeJsAnimateFunc = animate; // 給導覽功能調用
    sceneInitialized = true;
}


// === SKU Code Support Functions ===

/**
 * 從品項名稱中提取 SKU 編碼
 * @param {string} name - 品項名稱（可能含 SKU）
 * @returns {string|null} - SKU 編碼或 null
 * @example parseSKU("20-三角連結塊 [L-001]") => "L-001"
 */
window.parseSKU = function (name) {
    const match = name.match(/\[([^\]]+)\]/);
    return match ? match[1] : null;
};

/**
 * 移除品項名稱中的 SKU 編碼
 * @param {string} name - 品項名稱（可能含 SKU）
 * @returns {string} - 移除 SKU 後的名稱
 * @example removeSKU("20-三角連結塊 [L-001]") => "20-三角連結塊"
 */
window.removeSKU = function (name) {
    return name.replace(/\s*\[[^\]]+\]/g, '').trim();
};

/**
 * 模糊匹配庫存項目 (多維度比對：品名 + 系列)
 * @param {string} generatedKey - 系統產生的標準鍵值
 * @param {Array} inventoryList - 庫存陣列
 * @param {number} targetSeries - 目標系列 (20, 30, 40)
 * @returns {Object|null} - 匹配的庫存項目
 */
window.fuzzyMatchInventoryKey = function (generatedKey, inventoryList, targetSeries) {
    if (!inventoryList || !Array.isArray(inventoryList)) return null;

    const getName = (item) => (item.name || item.品項名稱 || item['品項名稱'] || "").toString().trim();
    const getSeries = (item) => (item.series || item.產品類型 || item['產品類型'] || "").toString().trim();

    // 正規化目標 Key
    const normalizedGenerated = window.normalizeScrewName(generatedKey);
    const cleanGenerated = normalizedGenerated.replace(/\(含[^)]+\)/g, '').replace(/（含[^）]+）/g, '').trim();

    // 1. 第一輪：過濾出正確系列的項目 (如果 targetSeries 有效)
    let filteredList = inventoryList;
    if (targetSeries && targetSeries !== 99) {
        filteredList = inventoryList.filter(item => {
            const s = getSeries(item);
            // 匹配 "20系列", "20系列 ", "20" 等格式
            return s.includes(targetSeries.toString());
        });
        // 如果過濾後沒東西，退回到全表匹配 (防止產品類型填錯)
        if (filteredList.length === 0) filteredList = inventoryList;
    }

    // 2. 精確匹配
    let exactMatch = filteredList.find(item => {
        let n = getName(item);
        return n === generatedKey || n === cleanGenerated || n === normalizedGenerated;
    });
    if (exactMatch) return exactMatch;

    // 3. 模糊匹配：移除 SKU 編碼與前綴後比對
    let fuzzyMatch = filteredList.find(item => {
        let invName = getName(item);
        let nameWithoutSKU = window.removeSKU(invName);
        
        // 移除庫存名稱中的系列前綴 (如 "20-", "30-") 並做正規化
        let nameCore = nameWithoutSKU.replace(/^\d{2}-/, '').replace(/\(含[^)]+\)/g, '').replace(/（含[^）]+）/g, '').trim();
        const normInvCore = window.normalizeScrewName(nameCore);
        const normInvWithoutSKU = window.normalizeScrewName(nameWithoutSKU);

        return normInvCore === cleanGenerated || 
               normInvCore === normalizedGenerated || 
               normInvWithoutSKU === normalizedGenerated ||
               window.normalizeScrewName(nameWithoutSKU.replace(/^\d{2}-/, '')) === cleanGenerated;
    });

    return fuzzyMatch || null;
};


function renderDetailCards(detailsStr, status) {
    console.log("Raw Order Details Str: ", detailsStr);
    if (!detailsStr) return "無明細";
    let lines = detailsStr.split(/\\n|\n/).filter(l => l.trim().length > 0);

    // 螺絲螺帽彙總 Map (key: 庫存鍵值, value: 數量)
    const screwNutTotals = new Map();

    // 第一輪：收集所有項目並進行分類與合計
    let normalItems = [];
    
    // 記憶上下文系列 (用來判斷沒標註系列的配件)
    let currentContextSeries = 99;

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
        let isFinished = line.includes('【自家成品】') || line.includes('自家成品');
        if (line.includes('【鋁材】') || line.includes('鋁材') || line.includes('鋁擠型')) type = 'profile';
        else if (isFinished) type = 'accessory';   // 自家成品：用配件式名稱扣帳，但標籤獨立顯示
        else if (line.includes('【配件】') || line.includes('配件')) type = 'accessory';

        // 1. [強化] 直接從「整行文字」偵測系列提示
        //    注意：必須先移除 SKU 和價格，避免 "$2040" 裡的 "20" 誤判為 20系列
        const lineForSeries = (window.removeSKU ? window.removeSKU(line) : line)
            .replace(/--\s*\$[0-9,]+/g, '')   // 移除價格
            .replace(/\( x \d+ \)/g, '')        // 移除數量
            .replace(/→\s*\$[0-9,]+/g, '');    // 移除另一種價格格式
        series = window.detectSeries(lineForSeries);


        // 2. [強化] 如果是鋁材，更新當前上下文系列
        if (type === 'profile' && series !== 99) {
            currentContextSeries = series;
        }

        // 3. [強化] 如果配件沒抓到系列，則繼承上下文
        if (type === 'accessory' && series === 99) {
            series = currentContextSeries;
        }

        // 4. [新增] 如果系列仍是 99，嘗試從行內的明確 SKU 反推系列
        //    例如 [M6-333] → M6 → 30 系列；[M8-FEET] → M8 → 40 系列
        if (series === 99 && type === 'accessory') {
            const skuInLine = window.parseSKU ? window.parseSKU(line) : null;
            if (skuInLine) {
                if (skuInLine.startsWith('M4')) series = 20;
                else if (skuInLine.startsWith('M6')) series = 30;
                else if (skuInLine.startsWith('M8')) series = 40;
            }
        }

        // 5. [新增] 如果系列仍是 99，從「單價」反推系列
        //    Sheet 訂單格式: 三角連結塊 ( x 300 ) -- $4500
        //    $4500 / 300 = $15/個 → 30系列 → M6-333
        if (series === 99 && type === 'accessory' && qty > 0) {
            const priceRawMatch = line.match(/--\s*\$([0-9,]+)/);
            if (priceRawMatch) {
                const subtotal = parseInt(priceRawMatch[1].replace(/,/g, ''));
                const unitPrice = Math.round(subtotal / qty);
                // 配件單價對照表 (固定定價，直接判斷)
                const accessoryPriceMap = {
                    // 三角連結塊
                    10: 20, 15: 30, 20: 40,
                    // 螺絲包
                    40: 20, 60: 30, 80: 40,
                    // 六角板手
                    12: 30,
                    // 腳杯/靜音輪
                    30: 30,
                };
                // 更精確：用品名+單價雙重確認
                const cleanForPrice = (window.removeSKU ? window.removeSKU(line) : line)
                    .replace(/^【.*?】\s*/, '').replace(/\( x \d+ \)/g, '').replace(/--\s*\$[0-9,]+/g, '').trim();

                if (cleanForPrice.includes('三角連結塊')) {
                    if (unitPrice === 10) series = 20;
                    else if (unitPrice === 15) series = 30;
                    else if (unitPrice === 20) series = 40;
                } else if (cleanForPrice.includes('平板連結片')) {
                    if (unitPrice === 20) series = 30;
                } else if (cleanForPrice.includes('靜音輪') || cleanForPrice.includes('腳杯固定器')) {
                    if (unitPrice === 30) series = 30;
                    else if (unitPrice === 40) series = 40;
                } else if (cleanForPrice.includes('六角板手')) {
                    if (unitPrice === 10) series = 20;
                    else if (unitPrice === 12) series = 30;
                    else if (unitPrice === 15) series = 40;
                } else if (cleanForPrice.includes('內六角螺絲') || cleanForPrice.includes('10枚/包')) {
                    if (unitPrice === 40) series = 20;
                    else if (unitPrice === 60) series = 30;
                    else if (unitPrice === 80) series = 40;
                }
            }
        }


        let itemName = line.replace(/^【.*?】\s*/, '').trim();
        // 取得乾淨品名
        let cleanBaseName = window.removeSKU(itemName)
            .replace(/\( x \d+ \)/g, '')
            .replace(/\s*--\s*\$[0-9,]+/g, '')
            .trim();


        // 強制判定 type (根據名稱關鍵字強化)
        if (window.isScrewOrNut(itemName)) {
            type = 'accessory';
        } else if (type === 'other' && (series !== 99 || itemName.includes('連接') || itemName.includes('連結') || itemName.includes('蓋') || itemName.includes('把手'))) {
            type = 'accessory';
        }

        if (type === 'accessory') {
            // [Requirement] Inspection only shows aluminum profiles. Skip accessories.
            if (status === 'inspection') return;

            // 1. 拆解內含螺絲
            window.extractAndAddScrewNutsToMap(itemName, qty, series, screwNutTotals);

            // 2. 統一解析主項資訊
            const info = window.resolveItemInfo(itemName, series);
            const skuHtml = info.sku ? ` <span style="font-size:0.85em; color:#999; font-weight:bold;">[${info.sku}]</span>` : '';

            // 3. 零件加總 vs 一般顯示
            if (window.isScrewOrNut(itemName)) {
                const current = screwNutTotals.get(info.finalKey) || 0;
                screwNutTotals.set(info.finalKey, current + qty);
            } else {
                // Remove trailing SKUs from the base name if they are already going to be appended
                const simplifiedName = window.removeSKU(info.cleanBase).replace(/\(含[^)]+\)/g, '').replace(/（含[^）]+）/g, '').trim();
                let formatted = `${isFinished ? '【自家成品】' : '【配件】'} <span style="font-weight:bold;">${simplifiedName}</span>${skuHtml}`;
                if (qtyMatch) formatted += ` <span style="color:#000; font-weight:bold;">( x ${qty} )</span>`;

                const displaySeries = info.series !== 99 ? info.series : series;
                normalItems.push({
                    raw: formatted, type, series: displaySeries,
                    seriesClass: (displaySeries !== 99) ? `series-${displaySeries}` : ''
                });
            }
        } else {
            // 鋁材項目
            const info = window.resolveItemInfo(itemName, series);
            const skuHtml = info.sku ? ` <span style="font-size:0.85em; color:#999; font-weight:bold;">[${info.sku}]</span>` : '';

            // Remove lingering SKUs from cleanBase to prevent duplicates
            const cleanBaseNoSKU = window.removeSKU(info.cleanBase);

            let formatted = `【鋁材】 <span style="font-weight:bold;">${cleanBaseNoSKU}</span>${skuHtml}`;
            const lenMatch = line.match(/\((?:L=|長度)(\d+(?:\.\d+)?)cm\)/);
            // Replace the hardcoded (L=xx) in cleanBase to prevent duplicates
            formatted = formatted.replace(/\(L=[\d.]+cm\)/g, '').replace(/\(長度[\d.]+cm\)/g, '').trim();
            if (lenMatch) formatted += ` <span style="color:#c0392b; font-weight:bold;">(長度${Math.round(Number(lenMatch[1]) * 10)}mm)</span>`;
            if (qtyMatch) formatted += ` <span style="color:#000; font-weight:bold;">( x ${qty} )</span>`;

            normalItems.push({
                raw: formatted, type, series,
                seriesClass: (series !== 99) ? `series-${series}` : ''
            });
        }
    });

    // 注入系列顏色樣式 (如果網頁中還沒有的話)
    // Always reinject series styles fresh (removed ID caching to ensure latest styles)
    const _oldSeriesStyle = document.getElementById('series-styles-v3');
    if (_oldSeriesStyle) _oldSeriesStyle.remove();
    const _seriesCss = `
        .series-20, .series-30, .series-40 {
            background: transparent !important;
            padding: 1px 6px !important;
            margin: 1px 0 !important;
            border-radius: 3px !important;
            font-size: 0.82rem !important;
            line-height: 1.25 !important;
        }
        .series-20 { border-left: 3px solid #6b8db0 !important; }
        .series-20 span { color: #6b8db0 !important; }
        .series-30 { border-left: 3px solid #b08850 !important; }
        .series-30 span { color: #b08850 !important; }
        .series-40 { border-left: 3px solid #5e8a5e !important; }
        .series-40 span { color: #5e8a5e !important; }
        .detail-card-inner { display: flex; flex-direction: column; gap: 2px; }
        .detail-item { position: relative; font-size: 0.82rem; line-height: 1.25; }
        @media (max-width: 768px) {
            .series-20, .series-30, .series-40, .detail-item {
                font-size: 0.68rem !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                max-width: 100% !important;
            }
            .detail-card {
                font-size: 0.68rem !important;
                white-space: nowrap !important;
                overflow: hidden !important;
            }
            .detail-card > div[style*="flex:1"] {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        }
    `;
    const _seriesStyleEl = document.createElement('style');
    _seriesStyleEl.id = 'series-styles-v3';
    _seriesStyleEl.appendChild(document.createTextNode(_seriesCss));
    (document.head || document.body).appendChild(_seriesStyleEl);

    // 將彙總的螺絲螺帽轉換為項目 (Skip for inspection)
    if (status !== 'inspection') {
        screwNutTotals.forEach((qty, key) => {
            let displayLabel = key;
            let seriesNum = 99;

            if (key.startsWith('[') && key.endsWith(']')) {
                const sku = key.slice(1, -1);
                let foundName = null;
                if (window.allInventory) {
                    const inv = window.allInventory.find(i => {
                        const pname = (i.name || i.品項名稱 || "").toString();
                        return pname.includes(sku);
                    });
                    if (inv) {
                        foundName = (inv.name || inv.品項名稱 || "").split('[')[0].trim();
                    }
                }

                // Fallback name generation if inventory lookup fails
                if (!foundName) {
                    if (sku.endsWith('M4')) foundName = sku.includes('1M4') ? 'M4六角螺絲' : 'M4螺母';
                    else if (sku.endsWith('M5')) foundName = sku.includes('1M5') ? 'M5六角螺絲' : 'M5螺母';
                    else if (sku.endsWith('M6')) foundName = sku.includes('1M6') ? 'M6六角螺絲' : 'M6螺母';
                    else if (sku.endsWith('M8')) foundName = sku.includes('1M8') ? 'M8六角螺絲' : 'M8螺母';
                    else foundName = '螺絲/螺母';
                }

                displayLabel = `🔩 ${foundName}`;
                seriesNum = window.detectSeries(foundName) || (sku.includes('A20') ? 20 : sku.includes('A30') ? 30 : sku.includes('A40') ? 40 : 99);
            }

            normalItems.push({
                raw: `【配件】 <span style="font-weight:bold;">${displayLabel}</span><span style="font-size:0.82em; color:#999; font-weight:bold; margin-left:4px;">${key}</span> <span style="color:#000; font-weight:bold;">( x ${qty} )</span>`,
                type: 'accessory',
                series: seriesNum,
                seriesClass: (seriesNum !== 99) ? `series-${seriesNum}` : '',
                isScrewNut: true
            });
        });
    }

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
        return 0;
    });

    // 組合 HTML
    let finalHtml = '<div class="detail-card-inner">';
    let enteredScrewNutSection = false;
    let prevType = null; // track type transitions for spacing

    normalItems.forEach(item => {
        // 鋁材→配件 空格
        if (prevType === 'profile' && item.type === 'accessory') {
            finalHtml += `<div style="margin-top:8px;"></div>`;
        }
        // 螺絲螺帽 空格
        if (item.isScrewNut && !enteredScrewNutSection) {
            finalHtml += `<div style="margin-top:8px;"></div>`;
            enteredScrewNutSection = true;
        }
        prevType = item.type;
        let isCheckable = false;
        if (status === 'picking') {
            isCheckable = true; // picking checks everything
        } else if (status === 'inspection') {
            isCheckable = (item.type === 'profile'); // inspection only checks aluminum
        } // packing is never checkable

        if (isCheckable) {
            finalHtml += `<div class="detail-card ${item.seriesClass}" onclick="toggleCheck(this)">
                <div class="check-box"><i class="fas fa-check" style="display:none; color:white;"></i></div>
                <div style="flex:1;">${item.raw}</div>
            </div>`;
        } else {
            // For packing or inspection (non-aluminum), show as plain items
            // However, we still want to show them. But if we are in inspection, we might still want to show accessories but not checkable.
            // Requirement was: "對料是對鋁材而已 所以可以只顯示鋁材 然後推進到檢貨單在全部顯示" -> only show aluminum in inspection.
            if (status === 'inspection' && item.type !== 'profile') {
                return; // Do not render non-aluminum items during inspection
            }
            finalHtml += `<div class="detail-item ${item.seriesClass}" style="padding:4px 8px; border:1px solid #eee; border-radius:5px; margin-bottom:3px; font-size:0.88rem;">
                ${item.raw}
            </div>`;
        }
    });
    finalHtml += '</div>';

    return finalHtml;
}

window.printOrder = function () {
    if (!window.currentOrderForPrint) { alert("無法取得訂單資料"); return; }
    let order = window.currentOrderForPrint;

    let detailsStr = order.details || "";
    let lines = detailsStr.split(/\\n|\n/).filter(l => l.trim().length > 0);

    const screwNutTotals = new Map();
    let items = [];

    // 邏輯需與 renderDetailCards 完全對齊
    lines.forEach(line => {
        let type = 'other';
        let series = 99;
        let qty = 1;

        const qtyMatch = line.match(/\( x (\d+) \)/);
        if (qtyMatch) qty = parseInt(qtyMatch[1]);

        let isFinished = line.includes('【自家成品】') || line.includes('自家成品');
        if (line.includes('【鋁材】') || line.includes('鋁材') || line.includes('鋁擠型')) type = 'profile';
        else if (isFinished) type = 'accessory';   // 自家成品：用配件式名稱扣帳，但標籤獨立顯示
        else if (line.includes('【配件】') || line.includes('配件')) type = 'accessory';

        let itemName = line.replace(/^【.*?】\s*/, '').trim();
        // 取得乾淨品名 (不含 SKU, 不含數量, 不含價格)
        let cleanBaseName = window.removeSKU(itemName)
            .replace(/\( x \d+ \)/, '')
            .replace(/\s*--\s*\$[0-9]+/g, '')
            .trim();

        if (series === 99) series = window.detectSeries(cleanBaseName);

        // [Fix] 如果系列仍是 99，嘗試從行內明確 SKU 反推 (與 renderDetailCards 同步)
        if (series === 99 && type === 'accessory') {
            const skuInLine = window.parseSKU ? window.parseSKU(line) : null;
            if (skuInLine) {
                if (skuInLine.startsWith('M4')) series = 20;
                else if (skuInLine.startsWith('M6')) series = 30;
                else if (skuInLine.startsWith('M8')) series = 40;
            }
        }

        if (window.isScrewOrNut(itemName)) {
            type = 'accessory';
        } else if (type === 'other' && series !== 99) {
            type = 'accessory';
        }

        if (type === 'accessory') {
            window.extractAndAddScrewNutsToMap(itemName, qty, series, screwNutTotals);
            const info = window.resolveItemInfo(itemName, series);

            if (window.isScrewOrNut(itemName)) {
                const current = screwNutTotals.get(info.finalKey) || 0;
                screwNutTotals.set(info.finalKey, current + qty);
            } else {
                const simplifiedName = window.removeSKU(info.cleanBase).replace(/\(含[^)]+\)/g, '').replace(/（含[^）]+）/g, '').trim();

                let seriesColor = '#333';
                if (series === 20) seriesColor = '#6b8db0';
                else if (series === 30) seriesColor = '#b08850';
                else if (series === 40) seriesColor = '#5e8a5e';

                const skuText = info.sku ? ` <span style="color:${seriesColor}">[${info.sku}]</span>` : '';
                items.push({ raw: `${isFinished ? '【自家成品】' : '【配件】'} <b>${simplifiedName}</b>${skuText} <b>(x${qty})</b>`, type, series });
            }
        } else {
            const info = window.resolveItemInfo(itemName, series);

            let seriesColor = '#333';
            if (series === 20) seriesColor = '#6b8db0';
            else if (series === 30) seriesColor = '#b08850';
            else if (series === 40) seriesColor = '#5e8a5e';

            const skuText = info.sku ? ` <span style="color:${seriesColor}">[${info.sku}]</span>` : '';
            const lenMatch = line.match(/\((?:L=|長度)(\d+)cm\)/);

            const cleanBaseNoSKU = window.removeSKU(info.cleanBase);
            let formattedBase = cleanBaseNoSKU.replace(/\(L=\d+cm\)/g, '').replace(/\(長度\d+cm\)/g, '').trim();

            let formatted = `【鋁材】 <b>${formattedBase}</b>${skuText}`;
            if (lenMatch) formatted += ` <b style="color:#c0392b">(${Number(lenMatch[1]) * 10}mm)</b>`;
            formatted += ` <b>(x${qty})</b>`;
            items.push({ raw: formatted, type, series });
        }
    });

    screwNutTotals.forEach((qty, key) => {
        let displayLabel = key;
        let seriesNum = 99;

        if (key.startsWith('[') && key.endsWith(']')) {
            const sku = key.slice(1, -1);
            if (window.allInventory) {
                const inv = window.allInventory.find(i => {
                    const pname = (i.name || i.品項名稱 || "").toString();
                    return pname.includes(sku);
                });
                if (inv) {
                    const namePart = (inv.name || inv.品項名稱 || "").split('[')[0].trim();
                    displayLabel = `${namePart} ${key}`;
                    seriesNum = window.detectSeries(namePart);
                }
            }
        }
        items.push({ raw: `【配件】 <b style="color:#e74c3c">🔩 ${displayLabel}</b> <b>(x${qty})</b>`, type: 'accessory', series: seriesNum, isScrewNut: true });
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

    let html20 = renderList(list20, "20 系列", "#6b8db0");
    let html30 = renderList(list30, "30 系列", "#b08850");
    let html40 = renderList(list40, "40 系列", "#5e8a5e");

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
                <div class="h-left">ALUMIBRO 鋁材兄弟 (${order.name}) <span style="font-weight:normal;">${order.phone}</span></div>
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

    // Auto-fetch inventory to ensure exact name mapping works
    if (!window.allInventory || window.allInventory.length === 0) {
        try {
            const tempRes = await fetch(ADMIN_API_URL + "?action=getInventory&t=" + new Date().getTime());
            const tempJson = await tempRes.json();
            let data = Array.isArray(tempJson) ? tempJson :
                (tempJson && Array.isArray(tempJson.inventory)) ? tempJson.inventory :
                    (tempJson && tempJson.data) ? tempJson.data : null;
            if (data) window.allInventory = data;
        } catch (err) {
            console.warn("⚠️ [deductInventory] 無法自動獲取庫存表，名稱映射可能失敗:", err.message);
        }
    }

    // Convert to payload directly and ensure EXACT name mapping (with SKU)
    let payloadItems = [];
    items.forEach(i => {
        // [Fix] Critical: Prevent empty names from maliciously matching the first inventory item
        if (!i.name || i.name.trim() === '') return;

        let actualName = i.name;
        if (window.allInventory && window.allInventory.length > 0) {
            let invItem = window.fuzzyMatchInventoryKey(i.name, window.allInventory, i.series || 99);
            
            if (invItem) {
                actualName = invItem.name || invItem.品項名稱 || i.name;
            } else if (i.name.startsWith('[') && i.name.endsWith(']')) {
                const sku = i.name.slice(1, -1);
                invItem = window.allInventory.find(inv => {
                    let n = (inv.name || inv.品項名稱 || "").toString();
                    return n.includes(`[${sku}]`);
                });
                if (invItem) actualName = invItem.name || invItem.品項名稱 || i.name;
            }
        }
        payloadItems.push({
            name: actualName,
            qty: i.qty,
            originalName: i.name,
            series: i.series || 99
        });
    });

    if (payloadItems.length === 0) {
        console.log("No valid items to deduct after filtering empty names.");
        return true;
    }

    // Send to GAS
    // Use proper CORS mode 'no-cors' if just firing, but we want response?
    // GAS Web App usually allows CORS if deployed as "Me" and "Anyone".

    try {
        await fetch(ADMIN_API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "deductInventory",
                items: payloadItems
            })
        }).catch(e => {
            console.warn("⚠️ [deductInventory] 無法讀取回應 (預期中，因 GAS CORS Redirect):", e.message);
        });

        console.log("✅ [deductInventory] 請求已送出");
        return true;
    } catch (e) {
        console.error("Fetch Error", e);
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
            if (typeof renderInventoryDashboard === 'function') {
                renderInventoryDashboard();
            }
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
    "3030輕型", "3060輕型", "3030重型", "3060重型", "6060輕型", "6060重型",
    "4040輕型", "4080輕型", "4040重型", "4080重型"
];

window.switchInventoryCategory = function (category) {
    const hub = document.getElementById('inventory-hub');
    const details = document.getElementById('inventory-details');
    if (!hub || !details) return;

    // Hide the entire hub (all 4 blocks disappear — same as desktop behavior)
    hub.classList.add('hidden');
    details.classList.remove('hidden');

    window.currentInventoryCategory = category;

    // Update Title
    const titleEl = document.getElementById('inventory-view-title');
    if (category === 'aluminum') {
        if (titleEl) titleEl.innerHTML = `<i class="fas fa-layer-group"></i> 鋁材庫存概覽`;
    } else if (category === 'finished') {
        if (titleEl) titleEl.innerHTML = `<i class="fas fa-box-open"></i> 自家成品庫存概覽`;
        window.currentInventorySeries = 'all';
    } else {
        if (titleEl) titleEl.innerHTML = `<i class="fas fa-tools"></i> 配件庫存概覽`;
        window.currentInventorySeries = 'all';
    }

    // [二級視窗] 把 topbar 的「返回」按鈕替換成「返回類別」
    const topbarBackBtn = document.querySelector('#dashboard .module-topbar .btn-back-hub-top');
    if (topbarBackBtn) {
        topbarBackBtn.dataset.originalHtml = topbarBackBtn.innerHTML;
        topbarBackBtn.dataset.originalOnclick = topbarBackBtn.getAttribute('onclick') || '';
        topbarBackBtn.innerHTML = '<i class="fas fa-arrow-left"></i> 返回類別';
        topbarBackBtn.setAttribute('onclick', 'backToInventoryHub()');
    }
    // 隱藏 inv-detail-header 內的舊「返回類別」按鈕（已移到 topbar）
    const oldBackBtn = document.querySelector('#inventory-details .inv-detail-header .btn-back-hub-top');
    if (oldBackBtn) oldBackBtn.style.display = 'none';

    filterInventory();
};

window.backToInventoryHub = function () {
    const hub = document.getElementById('inventory-hub');
    const details = document.getElementById('inventory-details');
    if (hub && details) {
        hub.classList.remove('hidden');
        details.classList.add('hidden');
    }
    // [還原] topbar 的按鈕還原成「返回」
    const topbarBackBtn = document.querySelector('#dashboard .module-topbar .btn-back-hub-top');
    if (topbarBackBtn && topbarBackBtn.dataset.originalHtml) {
        topbarBackBtn.innerHTML = topbarBackBtn.dataset.originalHtml;
        topbarBackBtn.setAttribute('onclick', topbarBackBtn.dataset.originalOnclick || 'backToHub()');
        delete topbarBackBtn.dataset.originalHtml;
        delete topbarBackBtn.dataset.originalOnclick;
    }
};


window.filterInventory = function () {
    if (!window.allInventory) return;
    const category = window.currentInventoryCategory;

    const filtered = window.allInventory.filter(item => {
        const name = ((() => {
            const keys = ['name', '品項名稱', '品項'];
            const objKeys = Object.keys(item);
            for (const k of objKeys) {
                if (keys.some(target => target.toLowerCase() === k.trim().toLowerCase())) return item[k];
            }
            return "";
        })()).toString().trim();

        // Tier 1: Category Check (Strict)
        const cat = (item.category || item['產品主分類'] || item['分類'] || item['主分類'] || '').toString().trim();
        const isFinished = (cat === '自家成品' || cat === '成品');
        const isAluminum = ALUMINUM_ALLOW_LIST.some(model => name.includes(model));
        let matchesCategory;
        if (category === 'finished') matchesCategory = isFinished;
        else if (category === 'aluminum') matchesCategory = isAluminum && !isFinished;
        else matchesCategory = !isAluminum && !isFinished;

        return matchesCategory;
    });

    renderInventory(filtered, false);
};

function renderInventory(inventory, isPartial = false) {
    const container = document.getElementById('inventory-content');
    const statsContainer = document.getElementById('inventory-stats');
    if (!container) return;

    // Helper to find value by multiple possible keys (ignoring spaces/case/partial)
    const findValue = (obj, keys) => {
        const objKeys = Object.keys(obj);
        // Debug: Log if we are looking for SKU and what keys we have
        if (keys.includes('sku')) {
            console.log("Looking for SKU in object keys:", objKeys, "Data:", obj);
        }
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

        // 配件額外過濾：名稱有前綴 OR 有系列欄（自家成品免此限制）
        const _cat = (findValue(item, ['category', '產品主分類', '分類', '主分類']) || '').toString().trim();
        const _isFinished = (_cat === '自家成品' || _cat === '成品');
        if (!isAluminum && !_isFinished) {
            const hasPrefix = name.match(/^(20|30|40)-(uff|.+)/);
            const seriesCol = (findValue(item, ['series', '產品類型', '系列']) || '').toString().replace('系列', '').trim();
            const hasSeriesCol = ['20', '30', '40'].includes(seriesCol);
            if (!hasPrefix && !hasSeriesCol) return false;
        }

        return true;
    });


    if (!Array.isArray(inventory) || inventory.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:50px; color:#999; border: 1px dashed #ddd; border-radius:8px;">沒有符合搜尋條件的庫存資料</div>';
        return;
    }


    // 【關鍵修復】清空容器，防止舊數據殘留
    container.innerHTML = '';

    // 非同步觸發水位上升動畫
    setTimeout(() => {
        document.querySelectorAll('.reservoir-fill-group').forEach(group => {
            group.style.transform = 'translateY(0)';
        });
    }, 100);

    let html = '<div class="inventory-grid">';

    let accessoryIndex = 0; // Track index for accessories only (重置)
    let svgMaskCounter = 0; // Global unique counter for SVG clipPath IDs

    // 先對配件進行分組（按商品類型）
    const accessoryGroups = new Map(); // key: baseName, value: array of items with different series
    const aluminumItems = [];

    inventory.forEach(item => {
        const name = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();
        const isAluminum = ALUMINUM_ALLOW_LIST.some(model => name.includes(model));
        const seriesCol = (findValue(item, ['series', '產品類型', '系列']) || '').toString().replace('系列', '').trim();
        const hasSeriesCol = ['20', '30', '40'].includes(seriesCol);

        // 過濾：必須是鋁材 OR 名稱有前綴 OR 有系列欄（自家成品免此限制）
        const _catR = (findValue(item, ['category', '產品主分類', '分類', '主分類']) || '').toString().trim();
        const _isFinishedR = (_catR === '自家成品' || _catR === '成品');
        if (!isAluminum && !_isFinishedR && !name.match(/^(20|30|40)-/) && !hasSeriesCol) return;

        if (isAluminum) {
            aluminumItems.push(item);
        } else {
            // 配件：提取基礎名稱（去掉系列前綴和SKU）
            let baseName = window.removeSKU(name).replace(/^(20|30|40|80)-/, '').trim();

            // [New] 提取 SKU 並存入物件中供後續使用
            // 優先找 '內部編號(SKU)' 或是 'J' 欄位的內容
            let rowSku = (findValue(item, ['內部編號(SKU)', 'sku', '內部編號', '編號', 'SKU']) || "").toString();
            if (!rowSku) {
                const m = name.match(/\[(.*?)\]/);
                if (m) rowSku = m[1];
            }
            item._sku = rowSku; 
            console.log(`Checking Item: ${name}, Found SKU: ${rowSku}`); // Debug line

            // 【統一螺絲螺母板手】移除規格前綴
            baseName = baseName.replace(/^M\d+/, '').trim();
            baseName = baseName.replace(/^\d+mm/, '').trim();

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
            if (name.includes('6060')) return 30; // 6060型屬於 30 系列
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

    // --- [2. 開始組合最終 HTML] ---
    // (已移除列表頁上方的短缺警報區塊，保持頁面簡潔)
    let lastSeries = null;
    let lastType = null;

    sortedInventory.forEach(item => {
        // 判斷是鋁材還是配件組
        const isAccessoryGroup = Array.isArray(item);

        if (isAccessoryGroup) {
            const [baseName, seriesItems] = item; 

            if (lastType !== 'accessory') {
                lastType = 'accessory';
            }

            // [自家成品] 簡化卡：只顯示單一庫存數量，不分系列、不套短缺警報徽章
            const _finItem0 = seriesItems[0];
            const _finCat = _finItem0 ? (findValue(_finItem0, ['category', '產品主分類', '分類', '主分類']) || '').toString().trim() : '';
            if (_finCat === '自家成品' || _finCat === '成品') {
                const _q = parseNum(findValue(_finItem0, ['qty', 'stock', '庫存數量', '數量']));
                const _finSku = _finItem0._sku || (findValue(_finItem0, ['sku', '內部編號', '編號', '內部編號(SKU)', 'SKU']) || '');
                const _low = _q < 5;
                html += `
                <div class="reservoir-card" style="grid-column: span 1; margin-bottom: 14px;">
                    <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06);">
                        <i class="fas fa-box-open" style="font-size:0.8rem; color:rgba(255,255,255,0.5);"></i>
                        <span style="font-size:1rem; font-weight:500; color:rgba(255,255,255,0.92);">${baseName}</span>
                        ${_finSku ? `<span style="font-family:'Consolas',monospace; font-size:0.6rem; color:rgba(255,255,255,0.45); margin-left:auto;">[${_finSku}]</span>` : ''}
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:2px;">
                        <span style="font-size:0.8rem; color:rgba(255,255,255,0.55);">現有庫存</span>
                        <div style="display:flex; align-items:baseline; gap:4px;">
                            <span style="font-size:1.7rem; font-weight:700; color:${_low ? '#f0c4c4' : 'rgba(255,255,255,0.95)'}; font-variant-numeric:tabular-nums;">${_q}</span>
                            <span style="font-size:0.7rem; color:rgba(255,255,255,0.4);">件</span>
                        </div>
                    </div>
                </div>`;
                return;
            }

            // [Shortage Alert Section]
            seriesItems.forEach(item => {
                const name = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();
                const rawStock = parseNum(findValue(item, ['qty', 'stock', '庫存數量', '數量', '庫存']));
                const defaultMax = 100;
                const percentage = Math.round((rawStock / defaultMax) * 100);

                if (percentage < 20) {
                    let series = '20'; // Default
                    // 智能推斷系列 (從名稱或 SKU)
                    const lowerName = name.toLowerCase();
                    const skuVal = (item._sku || findValue(item, ['內部編號(SKU)', 'sku', '內部編號', '編號', 'SKU']) || "").toString().toLowerCase();
                    
                    if (lowerName.includes('m4') || lowerName.includes('20') || skuVal.includes('m4') || skuVal.includes('20')) series = '20';
                    else if (lowerName.includes('m6') || lowerName.includes('30') || skuVal.includes('m6') || skuVal.includes('30')) series = '30';
                    else if (lowerName.includes('m8') || lowerName.includes('40') || skuVal.includes('m8') || skuVal.includes('40')) series = '40';

                    const fillLevel = Math.max(0, Math.min(percentage, 100));
                    const maskId = `crit-mask-${svgMaskCounter++}`;
                    
                    const sColors = {
                        '20': { color: '#b3c7d9', label: '20' },
                        '30': { color: '#c6a682', label: '30' },
                        '40': { color: '#b8ccb8', label: '40' }
                    };
                    const seriesConfig = sColors[series] || sColors['20'];
                    const rowSku = (item._sku || findValue(item, ['內部編號(SKU)', 'sku', '內部編號', '編號', 'SKU']) || "");

                    if (!html.includes('id="critical-items-box"')) {
                        html = `<div id="critical-items-box" class="critical-items-container" style="background: #fff; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                                <h3 style="color: var(--status-quoted); font-size: 1.1rem; margin-top: 0; margin-bottom: 20px; display: flex; align-items: center;">
                                    <i class="fas fa-exclamation-triangle" style="margin-right: 10px;"></i> 短缺警報
                                </h3>
                                <div style="display: flex; gap: 20px; flex-wrap: wrap;">` + html;
                    }

                    // 修改渲染樣式：圓圈內放數量，標籤上色
                    const critItemHtml = `
                    <div class="critical-item" style="text-align: center; min-width: 90px; flex: 0 0 auto;">
                        <svg width="55" height="55" viewBox="0 0 70 70">
                            <circle cx="35" cy="35" r="28" fill="#fef2f2" stroke="#fee2e2" stroke-width="1.5" />
                            <defs><clipPath id="${maskId}"><circle cx="35" cy="35" r="28" /></clipPath></defs>
                            <g clip-path="url(#${maskId})">
                                <rect x="0" y="${70 - (fillLevel * 0.7)}" width="70" height="70" fill="var(--status-quoted)" opacity="0.8" />
                            </g>
                            <text x="35" y="40" text-anchor="middle" font-size="16" font-weight="bold" fill="${fillLevel > 50 ? '#fff' : 'var(--status-quoted)'}">${rawStock}</text>
                        </svg>
                        <div style="margin-top: 8px;">
                            <span style="font-size: 0.6rem; color: #fff; background: ${seriesConfig.color}; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-family: 'Consolas', monospace; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">${rowSku || baseName}</span>
                        </div>
                    </div>`;

                    const insertionIdx = html.indexOf('<div style="display: flex; gap: 20px; flex-wrap: wrap;">') + '<div style="display: flex; gap: 20px; flex-wrap: wrap;">'.length;
                    html = html.slice(0, insertionIdx) + critItemHtml + html.slice(insertionIdx);
                }
            });

            const checkIsScrewOrNutSet = (name) => {
                const n = name.toLowerCase();
                return n.includes('螺絲') || n.includes('螺母') || n.includes('螺帽') || n.includes('滑塊') || n.includes('彈片');
            };
            const isScrewSet = checkIsScrewOrNutSet(baseName);
            const defaultMax = isScrewSet ? 1000 : 100;


            const seriesBadge = {
                '20': { bg: 'rgba(179,199,217,0.12)', text: 'rgba(179,199,217,0.9)', border: 'rgba(179,199,217,0.25)', bar: 'rgba(179,199,217,0.55)' },
                '30': { bg: 'rgba(198,166,130,0.12)', text: 'rgba(198,166,130,0.95)', border: 'rgba(198,166,130,0.25)', bar: 'rgba(198,166,130,0.55)' },
                '40': { bg: 'rgba(184,204,184,0.12)', text: 'rgba(184,204,184,0.95)', border: 'rgba(184,204,184,0.25)', bar: 'rgba(184,204,184,0.55)' }
            };

            html += `
            <div class="reservoir-card" style="grid-column: span 1; margin-bottom: 14px;">
                <div style="display:flex; align-items:baseline; gap:8px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06);">
                    <i class="fas fa-box" style="font-size:0.8rem; color:rgba(255,255,255,0.5);"></i>
                    <span style="font-size:1rem; font-weight:500; color:rgba(255,255,255,0.92);">${baseName}</span>
                    <span style="font-size:0.7rem; color:rgba(255,255,255,0.4); margin-left:auto;">基準量 ${defaultMax}</span>
                </div>
                <div style="display:flex; flex-direction:column; gap:9px;">`;

            ['20', '30', '40'].forEach(s => {
                const itemEntry = seriesItems.find(it => {
                    const n = (findValue(it, ['name', '品項名稱', '品項']) || "").toString();
                    const seriesCol = (findValue(it, ['series', '產品類型', '系列']) || "").toString().replace('系列', '').trim();
                    // Match by prefix (old format: "20-三角連結塊") OR by series column (new format)
                    return n.startsWith(s + '-') || seriesCol === s;
                });

                const rawStock = itemEntry ? parseNum(findValue(itemEntry, ['qty', 'stock', '庫存數量', '數量'])) : 0;
                let sku = itemEntry ? (itemEntry._sku || (findValue(itemEntry, ['sku', '內部編號', '編號', '內部編號(SKU)', 'SKU']) || "")) : "";
                
                const percentage = Math.round((rawStock / defaultMax) * 100);
                const hasItem = !!itemEntry;
                const displayPercent = hasItem ? percentage + '%' : 'N/A';
                const fillLevel = hasItem ? Math.max(0, Math.min(percentage, 100)) : 0;

                const sColors = {
                    '20': { color: '#b3c7d9', label: '20 系列' },
                    '30': { color: '#c6a682', label: '30 系列' },
                    '40': { color: '#b8ccb8', label: '40 系列' }
                };
                const config = sColors[s];
                let activeColor = hasItem ? config.color : '#f1f5f9';
                if (hasItem && percentage < 20) activeColor = 'var(--dusty-rose)';

                let textColor = hasItem ? '#475569' : '#cbd5e1';
                if (hasItem && rawStock < 0) textColor = 'var(--dusty-rose)';

                const radius = 22, viewBox = `0 0 60 60`, center = 30;
                const maskId = `acc-mask-${svgMaskCounter++}`; // Unique numeric ID, no Chinese chars
                const fillY = center + radius - (fillLevel / 100) * (radius * 2);

                // --- [Dashboard Shortage Alert Fix] ---
                let dashboardSeries = '20';
                const lowerName = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().toLowerCase();
                const skuVal = (sku || "").toString().toLowerCase();
                
                if (lowerName.includes('m4') || lowerName.includes('20') || skuVal.includes('m4') || skuVal.includes('20')) dashboardSeries = '20';
                else if (lowerName.includes('m6') || lowerName.includes('30') || skuVal.includes('m6') || skuVal.includes('30')) dashboardSeries = '30';
                else if (lowerName.includes('m8') || lowerName.includes('40') || skuVal.includes('m8') || skuVal.includes('40')) dashboardSeries = '40';

                const seriesConfig = sColors[dashboardSeries] || sColors['20'];

                const badge = seriesBadge[s];
                const isLow = hasItem && percentage < 20;
                const barColor = isLow ? 'rgba(212,160,160,0.6)' : badge.bar;
                const qtyColor = isLow ? '#f0c4c4' : 'rgba(255,255,255,0.85)';

                html += `
                <div style="display:flex; align-items:center; gap:8px; opacity:${hasItem ? 1 : 0.5};">
                    <span style="font-size:0.7rem; color:rgba(255,255,255,0.5); min-width:36px;">${s} 系</span>
                    <span style="font-family:'Consolas',monospace; font-size:0.62rem; color:${badge.text}; background:${badge.bg}; padding:2px 5px; border-radius:4px; border:1px solid ${badge.border}; min-width:90px; max-width:90px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sku || '—'}</span>
                    <div style="flex:1; height:6px; background:rgba(255,255,255,0.06); border-radius:99px; overflow:hidden;">
                        <div style="height:100%; width:${fillLevel}%; background:${barColor}; border-radius:99px; transition:width 1.2s cubic-bezier(0.4,0,0.2,1);"></div>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:3px; min-width:48px; justify-content:flex-end;">
                        <span style="font-size:0.9rem; font-weight:500; color:${qtyColor}; font-variant-numeric:tabular-nums;">${hasItem ? rawStock : '—'}</span>
                        <span style="font-size:0.65rem; color:rgba(255,255,255,0.4);">件</span>
                    </div>
                </div>`;
            });
            html += `</div></div>`;

        } else {
            // === 鋁材渲染：細長條版 ===
            const name = (findValue(item, ['name', '品項名稱', '品項']) || "").toString().trim();
            if (!name || name === '') return;

            // 分類過濾
            const currentCategory = window.currentInventoryCategory || 'aluminum';
            const isActuallyAluminum = ALUMINUM_ALLOW_LIST.some(m => name.includes(m));
            if (currentCategory === 'aluminum' && !isActuallyAluminum) return;
            if (currentCategory === 'accessory' && isActuallyAluminum) return;

            // 判定系列 (修正：6060明確指單到 30 系列，避免 fallback 失效)
            let series = 20;
            if (name.includes('6060')) {
                series = 30; // 6060 錢屬 30 系列
            } else {
                const seriesMatch = name.match(/(20|30|40)\d{2}/); // 尋找 2020, 2040, 3030 等格式
                if (seriesMatch) {
                    series = parseInt(seriesMatch[1]);
                } else {
                    if (name.includes('40')) series = 40;
                    else if (name.includes('30')) series = 30;
                    else series = 20;
                }
            }

            // 插入鋁材系列分隔標題 & 換行
            if (lastType !== 'aluminum' || lastSeries !== series) {
                // 如果已經有卡片了，先把 grid 容器關掉（避免跟上一系列混排）
                if (lastType === 'aluminum' && lastSeries !== null) {
                    html += `</div><div class="inventory-grid" style="margin-top: 15px;">`;
                }

                const sColors = {
                    20: { color: '#b3c7d9', label: '20 系列' },
                    30: { color: '#c6a682', label: '30 系列' },
                    40: { color: '#b8ccb8', label: '40 系列' }
                };

                html += `
                <div style="grid-column: 1 / -1; margin-top: 5px; margin-bottom: 5px; padding-bottom: 5px; border-bottom: 2px solid #f1f5f9;">
                    <h3 style="margin: 0; color: ${sColors[series].color}; font-size: 1.1rem; font-weight: 500; display: flex; align-items: center;">
                        <i class="fas fa-layer-group" style="margin-right: 8px;"></i>${sColors[series].label} 鋁材區
                    </h3>
                </div>`;
                lastType = 'aluminum';
                lastSeries = series;
            }

            const rawStock = parseNum(findValue(item, ['qty', 'stock', '庫存數量', '數量', '庫存']));
            const offcutsStr = (findValue(item, ['offcuts', '餘料', '備註']) || "").toString();

            // 1. 提取 SKU & 名稱
            const skuMatch = name.match(/\[([^\]]+)\]/);
            const sku = skuMatch ? `[${skuMatch[1]}]` : '[SKU]';
            const cleanName = name.replace(/\[[^\]]+\]/, '').trim();

            // 2. 存量計算 (基準量 60,000 cm)
            const defaultMaxLength = 60000;
            const totalBars = Math.floor(rawStock / 600);
            const percentage = Math.round((rawStock / defaultMaxLength) * 100);
            const fillWidth = Math.max(0, Math.min(percentage, 100));

            // 3. 餘料與廢料解析
            const offcuts = offcutsStr ? offcutsStr.split(/[,，、 ]+/).filter(s => s.trim() !== "").map(s => parseFloat(s)).filter(n => !isNaN(n)).sort((a, b) => b - a) : [];
            const offcutCount = offcuts.length;

            const wasteStr = (findValue(item, ['waste', '廢料']) || "").toString();
            const wasteValue = parseFloat(wasteStr) || 0;

            const sColors = {
                20: { color: '#b3c7d9', label: '20 系列' },
                30: { color: '#c6a682', label: '30 系列' },
                40: { color: '#b8ccb8', label: '40 系列' }
            };
            const config = sColors[series];

            let tubeColor = config.color;
            let isWarning = percentage < 20;
            // 低庫存顏色，統一使用跟配件水庫一樣的 var(--status-quoted) 或 --accent-mail 警告色
            if (isWarning) tubeColor = 'var(--status-quoted)'; // Rose Red

            const seriesAccent = {
                20: { bg: 'rgba(179,199,217,0.12)', text: 'rgba(179,199,217,0.9)', border: 'rgba(179,199,217,0.25)', bar: 'rgba(179,199,217,0.55)' },
                30: { bg: 'rgba(198,166,130,0.12)', text: 'rgba(198,166,130,0.95)', border: 'rgba(198,166,130,0.25)', bar: 'rgba(198,166,130,0.55)' },
                40: { bg: 'rgba(184,204,184,0.12)', text: 'rgba(184,204,184,0.95)', border: 'rgba(184,204,184,0.25)', bar: 'rgba(184,204,184,0.55)' }
            };
            const accent = seriesAccent[series] || seriesAccent[20];
            const barColor = isWarning ? 'rgba(212,160,160,0.6)' : accent.bar;
            const lengthCm = rawStock.toLocaleString();
            const lengthM = (rawStock / 100).toFixed(0);

            const specData = {
                '2020型': { weight: 0.458, priceCm: 1.3 }, '2040型': { weight: 0.862, priceCm: 2.4 },
                '3030輕型': { weight: 0.693, priceCm: 1.9 }, '3030重型': { weight: 1.07, priceCm: 2.9 },
                '3060輕型': { weight: 1.218, priceCm: 3.3 }, '3060重型': { weight: 1.844, priceCm: 5.0 },
                '6060輕型': { weight: 1.908, priceCm: 5.1 }, '6060重型': { weight: 2.763, priceCm: 7.5 },
                '4040輕型': { weight: 1.298, priceCm: 3.6 }, '4040重型': { weight: 1.923, priceCm: 5.2 },
                '4080輕型': { weight: 2.265, priceCm: 6.2 }, '4080重型': { weight: 3.505, priceCm: 9.5 }
            }[cleanName];
            const specRow = specData
                ? `<span><span style="color:rgba(255,255,255,0.75);">${specData.weight}</span> kg/m</span>
                   <span style="color:rgba(255,255,255,0.2);">·</span>
                   <span>$<span style="color:rgba(255,255,255,0.75);">${Math.round((specData.priceCm * 100) / specData.weight)}</span>/kg</span>`
                : '';

            html += `
            <div class="aluminum-tube-card" style="grid-column: span 1; border: 1px solid ${isWarning ? 'rgba(212,160,160,0.3)' : 'rgba(255,255,255,0.08)'};">
                <div class="tube-header" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div style="min-width:0; flex:1;">
                        <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:6px; flex-wrap:wrap;">
                            <span style="font-size:1.05rem; font-weight:500; color:rgba(255,255,255,0.92); letter-spacing:0.5px;">${cleanName}</span>
                            <span class="sku-badge" style="font-family:'Consolas',monospace; font-size:0.7rem; color:${accent.text}; background:${accent.bg}; padding:2px 8px; border-radius:4px; border:1px solid ${accent.border}; font-weight:400;">${sku.replace(/[\[\]]/g, '')}</span>
                            ${isWarning ? `<span style="font-size:0.65rem; color:#f0c4c4; background:rgba(212,160,160,0.18); padding:2px 7px; border-radius:99px; border:1px solid rgba(212,160,160,0.35);">短缺</span>` : ''}
                        </div>
                        <div style="display:flex; gap:14px; font-size:0.75rem; color:rgba(255,255,255,0.5); align-items:center;">
                            ${specRow}
                        </div>
                    </div>
                    <div class="offcut-drawer" style="display:flex; gap:6px; flex-shrink:0; position:relative;">
                        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:6px 10px; text-align:center; min-width:52px;">
                            <div style="font-size:0.95rem; font-weight:500; color:rgba(255,255,255,0.85); line-height:1;">${offcutCount}</div>
                            <div style="font-size:0.62rem; color:rgba(255,255,255,0.4); margin-top:3px; letter-spacing:0.3px;">片餘料</div>
                        </div>
                        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:6px 10px; text-align:center; min-width:52px;">
                            <div style="font-size:0.95rem; font-weight:500; color:rgba(255,255,255,0.85); line-height:1;">${wasteValue}</div>
                            <div style="font-size:0.62rem; color:rgba(255,255,255,0.4); margin-top:3px; letter-spacing:0.3px;">cm 廢料</div>
                        </div>
                        ${offcutCount > 0 ? `
                        <div class="offcut-tooltip">
                            <div style="font-size:0.75rem; font-weight:300; color:rgba(255,255,255,0.75); border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px; margin-bottom:5px;">餘料分布 (cm)</div>
                            <div class="offcut-list">
                                ${Object.entries(offcuts.reduce((acc, len) => {
                acc[len] = (acc[len] || 0) + 1;
                return acc;
            }, {})).map(([len, count]) => `
                                    <span class="offcut-item">${len}${count > 1 ? ` <small style="opacity:0.6; margin-left:2px;">x${count}</small>` : ''}</span>
                                `).join('')}
                            </div>
                        </div>` : ''}
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:12px; margin-top:4px;">
                    <div class="tube-container" style="flex:1; height:8px; background:rgba(255,255,255,0.06); border:none; border-radius:99px; overflow:hidden; box-shadow:none;">
                        <div class="tube-filler" style="width:${fillWidth}%; height:100%; background:${barColor}; border-radius:99px; transition:width 1.5s cubic-bezier(0.4,0,0.2,1);"></div>
                    </div>
                    <div style="display:flex; align-items:baseline; gap:4px; min-width:54px; justify-content:flex-end;">
                        <span style="font-size:1.1rem; font-weight:500; color:${isWarning ? '#f0c4c4' : 'rgba(255,255,255,0.9)'}; font-variant-numeric:tabular-nums;">${totalBars}</span>
                        <span style="font-size:0.7rem; color:rgba(255,255,255,0.4);">支</span>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:rgba(255,255,255,0.4); font-variant-numeric:tabular-nums; margin-top:2px;">
                    <span>${lengthCm} cm <span style="opacity:0.5; margin:0 4px;">/</span> ${lengthM} m</span>
                    <span style="color:${isWarning ? '#f0c4c4' : 'rgba(255,255,255,0.55)'};">${percentage}% <span style="opacity:0.6;">標配庫存</span></span>
                </div>
            </div>`;
        }
    });

    html += '</div>';
    container.innerHTML = html;

    // 觸發動畫
    setTimeout(() => {
        const fills = container.querySelectorAll('.reservoir-fill-group');
        fills.forEach(f => f.style.transform = 'translateY(0)');
        const tubeFillers = container.querySelectorAll('.tube-filler');
        tubeFillers.forEach(tf => {
            const w = tf.style.width;
            tf.style.width = '0%';
            setTimeout(() => tf.style.width = w, 50);
        });
    }, 100);
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
        <h2 style="color:#4A5A6B; text-align:center;">合併切料運算</h2>
        <p style="text-align:center; color:#7f8c8d;">共 ${list.length} 張訂單待切料</p>
        <div style="max-height:150px; overflow-y:auto; background:#f9f9f9; padding:10px; margin-bottom:20px; border:1px solid #eee;">`;

    list.forEach(o => {
        html += `<div style="font-size:0.9rem; border-bottom:1px dashed #eee; padding:5px;">
            <span style="font-weight:bold;">${o.name}</span> (${o.phone}) - ${window.safeParseDate(o.timestamp).toLocaleDateString()}
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
    const startBtn = document.querySelector('.btn-primary[onclick="runCuttingOptimization()"]');
    if (!area) return;

    if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在計算中...';
        startBtn.style.opacity = '0.7';
    }

    // Simulate a slight delay to allow the UI to paint the disabled button state
    await new Promise(resolve => setTimeout(resolve, 50));

    area.innerHTML = `<div style="text-align:center; padding:30px; font-size:1.2rem; color:var(--accent-20);"><i class="fas fa-cog fa-spin fa-2x"></i><br><br>正在同步庫存並計算最佳化排程...</div>`;

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
                // Standardize and map to exact inventory name BEFORE grouping to prevent split items
                let exactName = model;
                const skuMatch = model.match(/\[(.*?)\]/);

                if (window.allInventory && window.allInventory.length > 0) {
                    let match;
                    // First preference: Match by explicit SKU [XYZ]
                    if (skuMatch) {
                        const sku = skuMatch[1].trim();
                        match = window.allInventory.find(inv => {
                            let invName = (inv.name || inv.品項名稱 || "").toString();
                            return invName.includes(`[${sku}]`);
                        });
                    }
                    // Second preference: Fallback to old getInventoryKey standardizer
                    if (!match) {
                        let stdModel = window.getInventoryKey(model, 99);
                        match = window.allInventory.find(inv => {
                            let invName = (inv.name || inv.品項名稱 || "").toString();
                            return invName === stdModel || invName.includes(stdModel);
                        });
                    }
                    if (match) exactName = match.name || match.品項名稱 || model;
                }

                allItems.push({ model: exactName, length: len, qty: qty, orderId: o.timestamp });
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
        let invItem = window.allInventory.find(i => {
            let invName = (i.name || i.品項名稱 || "").toString();
            return invName === model; // Since we already mapped it exactly above!
        });

        // Fallback just in case
        if (!invItem) {
            const standardizedKey = window.getInventoryKey(model, 99);
            invItem = window.allInventory.find(i => {
                let invName = (i.name || i.品項名稱 || "").toString();
                return invName === standardizedKey || invName.includes(standardizedKey);
            });
        }

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

                candidates.forEach(raw => {
                    let len = raw;
                    // [自我修復] 一支整料=600cm，餘料不可能 >600。
                    // 若 >600 但 ÷10 後 ≤600，是舊版誤存的 mm 值 → 還原成 cm。
                    if (len > 600 && (len / 10) <= 600) {
                        len = len / 10;
                    }
                    if (len > 600) {
                        // ÷10 後仍 >600 → 真正異常（例如多段被串接）
                        dataWarning = `<div style="color:red; font-size:0.8rem; background:#fee; padding:5px; margin-bottom:5px; border-radius:4px;">
        <i class="fas fa-exclamation-triangle"></i> 警告：餘料數據異常(${raw})。<br>請檢查 Google Sheet 儲存格格式是否誤設為「數字」。請改為「純文字」。
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
        // [莫蘭迪配色] 使用系統 CSS 變數確保配色統一
        let s = window.detectSeries(model);
        let seriesColor = 'var(--accent-20)'; // 莫蘭迪藍
        if (s === 30) seriesColor = 'var(--accent-30)'; // 莫蘭迪橘
        else if (s === 40) seriesColor = 'var(--accent-40)'; // 莫蘭迪綠

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

                visualsHtml += `<div class="cut-row" style="display:flex; flex-direction:column; margin-bottom:10px; border:1px solid #94a3b8; border-left:3px solid #94a3b8; padding:5px; border-radius:4px; background:#f8f9fa;">`;
                let cutCounts = {};
                bin.cuts.forEach(c => { let k = (c * 10) + 'mm'; cutCounts[k] = (cutCounts[k] || 0) + 1; });
                let cutListStr = Object.keys(cutCounts).map(k => `${k} x${cutCounts[k]}`).join(', ');
                visualsHtml += `<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; margin-bottom:5px;">`;
                visualsHtml += `<div class="bin-header" style="font-weight:bold; color:#64748b; margin-right:10px;">餘料 ${bin.sourceLen * 10}mm</div>`;
                visualsHtml += `<div style="font-size:0.85rem; color:#555; font-weight:bold; text-align:right; flex:1; min-width:200px;">切料清單: ${cutListStr}</div>`;
                visualsHtml += `</div>`;
                visualsHtml += `<div style="width:100%; max-width:${widthPct}%; display:flex; height:30px; background:#eee; border-radius:4px; overflow:hidden;">`;

                bin.cuts.forEach(c => {
                    let pct = (c / bin.capacity) * 100;
                    visualsHtml += `<div class="cut-segment" style="width:${pct}%; background:${seriesColor}; border-right:1px solid #fff; color:#fff; font-size:10px; display:flex; align-items:center; justify-content:center;" title="切割 ${c * 10}mm">
        切 ${c * 10} mm
                     </div>`;
                });
                if (remain > 0) {
                    let rPct = (remain / bin.capacity) * 100;
                    visualsHtml += `<div class="cut-remain leftover" style="width:${rPct}%; background:${grayColors.offcut}; opacity:0.7; font-size:10px; display:flex; align-items:center; justify-content:center; color:#fff;" title="剩餘 ${(remain * 10).toFixed(0)}mm (餘料)">
        ${(remain * 10).toFixed(0)}
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

                visualsHtml += `<div class="cut-row" style="display:flex; flex-direction:column; margin-bottom:10px; border:1px solid ${seriesColor}; border-left:3px solid ${seriesColor}; padding:5px; border-radius:4px; background:#fff;">`;
                let cutCounts = {};
                bin.cuts.forEach(c => { let k = (c * 10) + 'mm'; cutCounts[k] = (cutCounts[k] || 0) + 1; });
                let cutListStr = Object.keys(cutCounts).map(k => `${k} x${cutCounts[k]}`).join(', ');
                visualsHtml += `<div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; margin-bottom:5px;">`;
                visualsHtml += `<div class="bin-header" style="font-weight:bold; color:${seriesColor}; margin-right:10px;">新料 #${idx + 1}</div>`;
                visualsHtml += `<div style="font-size:0.85rem; color:#555; font-weight:bold; text-align:right; flex:1; min-width:200px;">切料清單: ${cutListStr}</div>`;
                visualsHtml += `</div>`;
                visualsHtml += `<div style="width:100%; display:flex; height:30px; background:#eee; border-radius:4px; overflow:hidden;">`;

                bin.cuts.forEach(cutLen => {
                    let pct = (cutLen / 600) * 100;
                    visualsHtml += `<div class="cut-block" style="width:${pct}%; background:${seriesColor}; border-right:1px solid #fff; color:#fff; font-size:11px; display:flex; align-items:center; justify-content:center;" title="切割 ${cutLen * 10}mm">
                        <span>切 ${cutLen * 10} mm</span>
                    </div>`;
                });

                if (remain > 0) {
                    let rPct = (remain / 600) * 100;
                    let color = isRemCheck ? grayColors.offcut : grayColors.waste;
                    let type = isRemCheck ? '余料' : '废料';
                    let cls = isRemCheck ? 'cut-remain leftover' : 'cut-remain waste';

                    visualsHtml += `<div class="${cls}" style="width:${rPct}%; background:${color}; color:#fff; font-size:10px; display:flex; align-items:center; justify-content:center; opacity:0.8;" title="剩余 ${(remain * 10).toFixed(0)}mm (${type})">
                        ${(remain * 10).toFixed(0)} mm
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
        <button onclick="window.printCuttingList()" style="background:var(--accent-20); color:white; padding:12px 24px; border:none; border-radius:6px; font-size:1.1rem; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
            <i class="fas fa-print"></i> 列印切料表
        </button>
        <button class="btn-record-offcut" onclick="try{window.recordCuttingPlanToInventory()}catch(e){alert('Error: '+e.message)}" style="background:var(--accent-20); color:white; padding:12px 24px; border:none; border-radius:6px; font-size:1.1rem; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.1);">
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
                :root {
                    --accent-20: #b3c7d9;
                    --accent-30: #c6a682;
                    --accent-40: #b8ccb8;
                }
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
                    page-break-before: auto;
                    page-break-inside: avoid;
                    margin-bottom: 20px;
                }
                .cut-row {
                    margin-bottom: 8px !important;
                }
                .no-print { display: none !important; }
                @media print {
                    body { padding: 0; }
                    .cutting-model-section {
                        page-break-before: auto;
                        page-break-inside: avoid;
                        margin-bottom: 20px;
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

        const skuMatch = modelName.match(/\[(.*?)\]/);
        let stdName = window.getInventoryKey(modelName, 99);

        // Map back to the exact name (with SKU) existing in backend
        if (window.allInventory && window.allInventory.length > 0) {
            let invItem;
            // A. First Priority: Absolute SKU Match
            if (skuMatch) {
                const sku = skuMatch[1].trim().toUpperCase();
                invItem = window.allInventory.find(inv => {
                    let invName = (inv.name || inv.品項名稱 || "").toString().toUpperCase();
                    return invName.includes(`[${sku}]`);
                });
            }
            // B. Second Priority: Exact Match (Case Insensitive)
            if (!invItem) {
                invItem = window.allInventory.find(inv => {
                    let invName = (inv.name || inv.品項名稱 || "").toString().trim();
                    return invName === modelName;
                });
            }
            // C. Third Priority: Standardized Key Match (Strict for 30/40/6060 series)
            if (!invItem) {
                invItem = window.allInventory.find(inv => {
                    let invName = (inv.name || inv.品項名稱 || "").toString();
                    let standardInv = window.getInventoryKey(invName, 99);
                    
                    // 關鍵修復：如果是 6060/30/40 等有輕重分型的，標準化 key 必須完全一致
                    if (stdName.includes('輕') || stdName.includes('重')) {
                        return standardInv === stdName;
                    }
                    
                    return invName === stdName || invName.includes(stdName);
                });
            }
            if (invItem) {
                modelName = invItem.name || invItem.品項名稱 || (skuMatch ? modelName : stdName);
            } else {
                modelName = skuMatch ? modelName : stdName;
            }
        } else {
            modelName = skuMatch ? modelName : stdName;
        }

        // Robust DOM traversal: Find the parent section, then query the visuals inside it
        let parentSection = header.closest('.cutting-model-section');
        let visualsDiv = parentSection ? parentSection.querySelector('.cutting-visuals') : null;

        if (!visualsDiv) {
            console.warn("Could not find .cutting-visuals for", modelName);
            return;
        }

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
            // Case B: Offcut (餘料) — header 是「餘料 XXXmm」，數字是 mm，要 ÷10 還原 cm
            else if (headerText.includes('餘料')) {
                const match = headerText.match(/(\d+(\.\d+)?)\s*mm/);
                if (match) {
                    cuttingPlans[modelName].removeOffcuts.push(parseFloat(match[1]) / 10); // [修正] mm → cm
                }
            }

            // Check Remainder (for all rows)
            const remainDiv = row.querySelector('.cut-remain');
            if (remainDiv) {
                // 注意：title 內數字是 mm（render 時 ×10 顯示），必須 ÷10 還原成 cm
                const title = remainDiv.getAttribute('title') || "";
                const remainMatch = title.match(/[\d.]+/);

                if (remainMatch) {
                    const remainLen = parseFloat(remainMatch[0]) / 10; // [修正] mm → cm
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

    // Visual feedback: disable button
    const btn = document.querySelector('.btn-record-offcut');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 切料計算並更新庫存中...';
        btn.style.opacity = '0.7';
    }

    // Update Inventory via API
    try {
        const updates = [];
        const updateModels = [];
        for (let modelName in cuttingPlans) {
            const plan = cuttingPlans[modelName];
            // Skip empty plans
            if (plan.deductStandardCM === 0 && plan.removeOffcuts.length === 0 && plan.addOffcuts.length === 0 && plan.addWasteCM === 0) continue;

            updateModels.push(modelName);
            updates.push(fetch(ADMIN_API_URL, {
                method: "POST",
                body: JSON.stringify({
                    action: "updateInventoryWithCuttingPlan",
                    modelName: modelName,
                    deductStandardCM: plan.deductStandardCM,
                    removeOffcuts: plan.removeOffcuts,
                    addOffcuts: plan.addOffcuts,
                    addWasteCM: plan.addWasteCM
                })
            }).catch(e => {
                console.warn(`⚠️ [recordCutting] "${modelName}" 無法讀取回應 (預期中):`, e.message);
            }));
        }

        if (updates.length === 0) {
            alert("沒有需要更新的項目。");
            if (btn) { btn.disabled = false; btn.innerHTML = originalBtnHtml; btn.style.opacity = '1'; }
            return;
        }

        await Promise.all(updates);
        console.log("📤 [recordCutting] 請求送出，等待後端處理...");

        // 等待後端處理完畢，然後透過 GET 驗證庫存是否已更新
        await new Promise(resolve => setTimeout(resolve, 2500));

        let verified = false;
        try {
            const verifyRes = await fetch(ADMIN_API_URL + "?action=getInventory&t=" + new Date().getTime());
            const verifyJson = await verifyRes.json();
            let verifyData = null;
            if (Array.isArray(verifyJson)) verifyData = verifyJson;
            else if (verifyJson && Array.isArray(verifyJson.inventory)) verifyData = verifyJson.inventory;
            else if (verifyJson && verifyJson.data) verifyData = verifyJson.data;

            if (verifyData) {
                window.allInventory = verifyData;
                verified = true;
                console.log("✅ [recordCutting] 重新取得最新庫存");
            }
        } catch (verifyErr) {
            console.warn("⚠️ [recordCutting] 無法驗證更新結果:", verifyErr);
        }

        if (verified) {
            alert(`✅ 庫存與餘料已成功更新！\n\n已更新型號: ${updateModels.join(', ')}`);
        } else {
            alert(`✅ 庫存更新指令已送出！\n\n（無法立即驗證結果，請稍後重整庫存頁面確認）\n已更新型號: ${updateModels.join(', ')}`);
        }

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

                // 4. [修正] POST 後端，讓手機/別台同步（切料→品檢 之前漏了這步）
                window.persistOrderStatus(o.timestamp, 'inspection', o);

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
        const btn = document.querySelector('.btn-record-offcut');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save"></i> 確認切割計畫並更新庫存';
            btn.style.opacity = '1';
        }
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

// ==========================================
// HISTORY ORDERS MODULE
// ==========================================
let currentHistorySearch = "";

window.filterHistoryOrders = function () {
    currentHistorySearch = document.getElementById('history-search').value.trim().toLowerCase();
    renderHistoryOrders();
};

window.renderHistoryOrders = function () {
    const container = document.getElementById('history-content');
    if (!ordersData || ordersData.length === 0) {
        container.innerHTML = `<div class="history-empty"><i class="fas fa-box-open"></i><p>尚無歷史訂單資料</p></div>`;
        return;
    }

    // Filter only completed orders, and apply search
    let completedOrders = ordersData.filter(o => o.status === 'completed');

    if (currentHistorySearch) {
        completedOrders = completedOrders.filter(o => {
            const searchStr = `${o.name || ''} ${o.phone || ''} ${o.address || ''} ${o.summary || ''}`.toLowerCase();
            return searchStr.includes(currentHistorySearch);
        });
    }

    if (completedOrders.length === 0) {
        container.innerHTML = `<div class="history-empty"><i class="fas fa-search"></i><p>找不到符合的歷史訂單</p></div>`;
        return;
    }

    // Sort orders by date descending
    completedOrders.sort((a, b) => window.safeParseDate(b.timestamp).getTime() - window.safeParseDate(a.timestamp).getTime());

    const grouped = {};
    completedOrders.forEach(o => {
        const date = window.safeParseDate(o.timestamp);
        const monthKey = `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
        if (!grouped[monthKey]) grouped[monthKey] = [];
        grouped[monthKey].push(o);
    });

    let html = '';

    for (const month in grouped) {
        const monthOrders = grouped[month];
        const monthRevenue = monthOrders.reduce((sum, o) => sum + window.safeParsePrice(o.total), 0);

        let ordersHtml = monthOrders.map(o => {
            const dateStr = window.safeParseDate(o.timestamp).toLocaleString('zh-TW', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            let tag = "";
            let addrStr = o.address || "";
            let isSelfPickup = addrStr.includes("自取") || addrStr.includes("[自取]");
            let isStore = addrStr.includes("店到店") || addrStr.includes("超商") || addrStr.includes("7-11") || addrStr.includes("全家") || addrStr.includes("[店到店]");

            const tagStyle = `style="background:var(--status-completed, #94a3b8);color:#fff;"`;
            if (isStore) tag = `<span class="card-tag" ${tagStyle}>店到店</span>`;
            else if (isSelfPickup) tag = `<span class="card-tag" ${tagStyle}>自取</span>`;
            else if (addrStr.includes("公司配送")) tag = `<span class="card-tag" ${tagStyle}>公司配送</span>`;
            else if (addrStr.includes("宅配")) tag = `<span class="card-tag" ${tagStyle}>宅配</span>`;

            // Data Visualization: Series composition sparkline
            const itemsInfo = window.parseOrderItemsRobust ? window.parseOrderItemsRobust(o) : { count20: 0, count30: 0, count40: 0, countProfile: 0, countAccessory: 0 };
            const totalItems = (itemsInfo.countProfile + itemsInfo.countAccessory) || 1;
            const p20 = (itemsInfo.count20 / totalItems) * 100;
            const p30 = (itemsInfo.count30 / totalItems) * 100;
            const p40 = (itemsInfo.count40 / totalItems) * 100;
            // The rest is accessories
            let pAcc = 100 - (p20 + p30 + p40);
            if (pAcc < 0) pAcc = 0;

            let sparklineHtml = '';
            // Only show if there's actual parsed content
            if ((itemsInfo.countProfile + itemsInfo.countAccessory) > 0) {
                sparklineHtml = `
                    <div class="history-sparkline">
                        ${p20 > 0 ? `<div class="spark-bar bg-20" style="width:${p20}%" title="20系列 (${Math.round(p20)}%)"></div>` : ''}
                        ${p30 > 0 ? `<div class="spark-bar bg-30" style="width:${p30}%" title="30系列 (${Math.round(p30)}%)"></div>` : ''}
                        ${p40 > 0 ? `<div class="spark-bar bg-40" style="width:${p40}%" title="40系列 (${Math.round(p40)}%)"></div>` : ''}
                        ${pAcc > 0 ? `<div class="spark-bar bg-acc" style="width:${pAcc}%" title="配件 (${Math.round(pAcc)}%)"></div>` : ''}
                    </div>
                `;
            }

            return `
                <div class="kanban-card history-order-card" onclick="viewOrder('${o.timestamp}')">
                    <div class="card-header">
                        <div class="card-meta" style="flex:1;">
                            <span class="card-no">
                                <i class="far fa-calendar-alt"></i> ${dateStr}
                            </span>
                        </div>
                        ${tag}
                    </div>
                    <div class="card-body">
                        <div class="card-title">${o.name || '客戶'}</div>
                        <div class="card-main-content">
                            <div class="card-contact">
                                <div class="card-info"><i class="fas fa-phone-alt"></i> ${o.phone || '無電話'}</div>
                                <div class="card-info"><i class="fas fa-truck"></i> <span style="font-size: 0.8rem; opacity:0.8;">${addrStr || '不需寄送'}</span></div>
                                ${sparklineHtml}
                            </div>
                            <div class="card-price-container">
                                <div class="card-price">
                                    $${window.safeParsePrice(o.total).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        html += `
            <div class="history-month-group">
                <div class="history-month-header" onclick="toggleMonth(this)">
                    <div class="month-label">${month}</div>
                    <div class="month-stats">
                        <span class="month-count">${monthOrders.length} 筆</span>
                        <span class="month-revenue">$${monthRevenue.toLocaleString()}</span>
                        <i class="fas fa-chevron-right month-chevron"></i>
                    </div>
                </div>
                <div class="history-month-body">
                    ${ordersHtml}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Expand the first month by default
    const firstHeader = container.querySelector('.history-month-header');
    if (firstHeader) toggleMonth(firstHeader);
};

window.toggleMonth = function (headerEl) {
    headerEl.classList.toggle('expanded');
    const body = headerEl.nextElementSibling;
    if (body) {
        if (body.classList.contains('show')) {
            body.classList.remove('show');
            body.style.display = 'none';
        } else {
            body.classList.add('show');
            body.style.display = 'block';
        }
    }
};

// ==========================================
// FINANCIAL REPORTS MODULE
// ==========================================
let chartsInstance = {};

window.chartConfigs = {
    trend: { time: 'day', cat: 'all' },
    series: { time: 'month', cat: 'all' },
    delivery: { time: 'month', cat: 'all' },
    top10: { time: 'month', cat: 'all' },
    seriesMix: { time: 'month' },
    crossSell: { time: 'month' },
    logistics: { time: 'month' }
};

// --- UI Helpers for Financial Reports ---
window.updateFinancialButtonVisibility = function () {
    const viewModeEl = document.getElementById('report-view-mode');
    const mode = viewModeEl ? viewModeEl.value : 'single';
    const module = document.getElementById('reports-module');
    if (!module) return;

    if (mode === 'trend') {
        module.classList.add('mode-trend');
        module.classList.remove('mode-single');
    } else {
        module.classList.add('mode-single');
        module.classList.remove('mode-trend');
    }
    console.log(`[📊 Financial Report] View Mode updated: ${mode}`);
};

// --- Financial Month Switcher Logic ---
window.shiftFinancialMonth = function (delta) {
    let yearEl = document.getElementById('report-active-year');
    let monthEl = document.getElementById('report-active-month');
    if (!yearEl || !monthEl || !yearEl.value) {
        let d = new Date();
        if (yearEl) yearEl.value = d.getFullYear();
        if (monthEl) monthEl.value = d.getMonth() + 1;
    }

    let y = parseInt(document.getElementById('report-active-year').value) || new Date().getFullYear();
    let m = parseInt(document.getElementById('report-active-month').value) || (new Date().getMonth() + 1);

    let d = new Date(y, m - 1 + delta, 1);
    document.getElementById('report-active-year').value = d.getFullYear();
    document.getElementById('report-active-month').value = d.getMonth() + 1;
    document.getElementById('current-financial-period').innerText = `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, '0')}`;

    // Auto-set single month mode if navigating month-by-month
    document.getElementById('report-view-mode').value = 'single';

    window.updateFinancialButtonVisibility();
    renderFinancialReports();
};

window.toggleFinancialViewMode = function () {
    const mode = document.getElementById('report-view-mode').value;
    const year = document.getElementById('report-active-year').value;
    const month = document.getElementById('report-active-month').value;

    if (mode === 'trend') {
        document.getElementById('current-financial-period').innerText = `${year} 全年度`;
    } else {
        document.getElementById('current-financial-period').innerText = `${year} / ${String(month).padStart(2, '0')}`;
    }

    window.updateFinancialButtonVisibility();
    renderFinancialReports();
};


window.setChartFilter = function (chartId, filterType, value) {
    if (window.chartConfigs[chartId]) {
        window.chartConfigs[chartId][filterType] = value;
    }

    const ids = filterType === 'time' ? ['month', 'week', 'day'] : ['all', 'profile', 'accessory', 'finished'];
    ids.forEach(id => {
        const btn = document.getElementById(`toggle-${chartId}-${filterType}-${id}`);
        if (btn) {
            if (id === value) {
                btn.classList.add('active');
                btn.style.background = 'var(--accent-mail)';
                btn.style.color = '#fff';
                btn.style.opacity = '1';
            } else {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = '#888'; // Visible grey
                btn.style.opacity = '0.8';
            }
        }
    });

    renderFinancialReports();
}

function timeFilterPassed(d, timeConfig, baseDate = new Date()) {
    const bYear = baseDate.getFullYear();
    const bMonth = baseDate.getMonth();

    if (timeConfig === 'day') {
        return d.getFullYear() === bYear && d.getMonth() === bMonth && d.getDate() === baseDate.getDate();
    }
    if (timeConfig === 'week') {
        const diff = baseDate.getTime() - d.getTime();
        return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
    }
    if (timeConfig === 'month') {
        return d.getFullYear() === bYear && d.getMonth() === bMonth;
    }
    return true;
}

function parseOrderItemsRobust(o) {
    const detailsText = (o.details || "").toString();
    const summaryText = (o.summary || "").toString();
    let itemsArr = [];

    if (detailsText.includes('\n') || detailsText.includes('【')) {
        itemsArr = detailsText.split('\n');
    } else if (summaryText) {
        let safeSummary = summaryText.replace(/\(含[^)]+\)/g, '').replace(/（含[^）]+）/g, '');
        itemsArr = safeSummary.split(/[\n,+;]/);
    }

    let stats = {
        count20: 0, count30: 0, count40: 0, countOther: 0,
        countProfile: 0, countAccessory: 0, countFinished: 0,
        itemsMapTotal: {},
        paramMap: {}
    };

    itemsArr.forEach(itemStr => {
        itemStr = itemStr.trim();
        let isProfile = false;
        let skuMatch = itemStr.match(/\[(.*?)\]/);
        let sku = skuMatch ? skuMatch[1].trim() : "";

        let cleanName = "";
        if (sku) {
            cleanName = `[${sku}]`;
        } else {
            cleanName = itemStr.replace(/【[^】]+】/g, '').replace(/\(含[^)]+\)/g, '').replace(/（含[^）]+）/g, '')
                .replace(/NT\$\s*[\d,]+/gi, '').replace(/\$\s*[\d,]+/g, '').replace(/[\d,]+\s*元/g, '')
                .replace(/\(\s*x\s*\d+\s*\)/gi, '').replace(/x\s*\d+\s*$/i, '').replace(/x\s*\d+/gi, '')
                .replace(/[\d.]+cm/gi, '').replace(/\(L=\d+cm\)/gi, '').replace(/\(長度\d+cm\)/gi, '').trim();
        }

        if (!cleanName || cleanName.length < 2 || cleanName.match(/^[-=\s*]*$/) || cleanName === "[]" || cleanName === "[ ]") return;

        // [強化分類邏輯] 確保 [M4-6] 板手等配件不會被誤認成鋁材
        if (sku.match(/^A\d{2}/i)) isProfile = false;
        else if (sku.match(/^M\d/i)) isProfile = false; // M4, M6, M8 開頭的 SKU 通常是配件
        else if (sku.match(/2020|2040|2080|3030|3060|6060|30135|3045|4040|4080|8080|HR-/i)) isProfile = true;
        else {
            // 透過關鍵字深度辨識
            const isAccessoryText = itemStr.match(/螺|連接|連結|把手|輪|鉸鏈|絞鍊|蓋|墊|角件|封邊|角柱|層板|滑塊|固定器|扣板|支撐架|板手|扳手|工具|組/);
            const isProfileText = itemStr.match(/cm|長度|L=|\d角槽|鋁材|型|支/i);
            
            if (isAccessoryText) isProfile = false;
            else if (isProfileText) isProfile = true;
            else isProfile = false; // 預設改為配件，避免污染鋁材統計
        }

        // [同步報表判斷] 統一使用 global 偵測器，確保同步後的 SKU [M8-XXX] 能被正確認識
        let sNum = window.detectSeries(itemStr);
        let series = (sNum !== 99) ? sNum.toString() : "";

        if (series === "30") stats.count30++;
        else if (series === "40") stats.count40++;
        else if (series === "20") stats.count20++;
        else stats.countOther++;

        // [自家成品分類] 先認自家成品（訂單標籤【自家成品】或成品SKU），避免被併進配件
        let isFinished = /【自家成品】|【成品】/.test(itemStr) || /PHONE-STAND|CART-STD|FOOD-CAR/i.test(sku);
        if (isFinished) stats.countFinished++;
        else if (isProfile) stats.countProfile++;
        else stats.countAccessory++;

        const qtyMatch = itemStr.match(/\(\s*x\s*(\d+)\s*\)/i) || itemStr.match(/x\s*(\d+)(?!\S)/i) || itemStr.match(/\*\s*(\d+)/);
        let qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

        if (isProfile) {
            const lenMatch = itemStr.match(/L\s*=?\s*(\d+(?:\.\d+)?)\s*cm/i) || itemStr.match(/(\d+(?:\.\d+)?)\s*cm/i);
            let profileLength = lenMatch ? parseFloat(lenMatch[1]) : 0;
            if (profileLength > 0) {
                qty = (profileLength * qty) / 600.0;
            }
        }

        if (!stats.itemsMapTotal[cleanName]) stats.itemsMapTotal[cleanName] = 0;
        stats.itemsMapTotal[cleanName] += qty;

        stats.paramMap[cleanName] = { isProfile, series };
    });
    return stats;
}

window.renderFinancialReports = function () {
    if (!ordersData || ordersData.length === 0) return;
    const module = document.getElementById('reports-module');
    if (!module) return;

    // Initialize period if empty or NaN
    let yearInput = document.getElementById('report-active-year');
    let monthInput = document.getElementById('report-active-month');
    let periodSpan = document.getElementById('current-financial-period');

    if (!yearInput.value || isNaN(parseInt(yearInput.value))) {
        const d = new Date();
        yearInput.value = d.getFullYear();
        monthInput.value = d.getMonth() + 1;
        if (periodSpan) periodSpan.innerText = `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    const viewMode = document.getElementById('report-view-mode') ? document.getElementById('report-view-mode').value : 'single';
    const selYear = parseInt(yearInput.value);
    const selMonth = parseInt(monthInput.value);
    const now = new Date();

    window.updateFinancialButtonVisibility();

    // Auto-adjust granularity based on viewMode
    if (viewMode === 'single') {
        // Narrow look: use Day/Week
        if (window.chartConfigs.trend.time === 'month') window.chartConfigs.trend.time = 'day';
        if (window.chartConfigs.seriesMix.time === 'month') window.chartConfigs.seriesMix.time = 'day';
        if (window.chartConfigs.crossSell.time === 'month') window.chartConfigs.crossSell.time = 'day';
    } else {
        // Wide look: use Month
        window.chartConfigs.trend.time = 'month';
        window.chartConfigs.seriesMix.time = 'month';
        window.chartConfigs.crossSell.time = 'month';
    }

    const reportOrders = ordersData.filter(o => {
        if (o.status !== 'completed') return false;
        const oDate = window.safeParseDate(o.timestamp);
        if (viewMode === 'single') {
            return oDate.getFullYear() === selYear && (oDate.getMonth() + 1) === selMonth;
        } else {
            return oDate.getFullYear() === selYear;
        }
    });

    const cutoffDateStart = viewMode === 'single' ? new Date(selYear, selMonth - 1, 1) : new Date(selYear, 0, 1);
    const cutoffDateEnd = viewMode === 'single' ? new Date(selYear, selMonth, 0, 23, 59, 59) : new Date(selYear, 11, 31, 23, 59, 59);

    const totalRevenue = reportOrders.reduce((sum, o) => sum + window.safeParsePrice(o.total), 0);
    const orderCount = reportOrders.length;
    const avgOrderValue = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;

    const allOrdersInRange = ordersData.filter(o => window.safeParseDate(o.timestamp).getTime() >= cutoffDateStart.getTime());
    const completionRate = allOrdersInRange.length > 0 ? Math.round((orderCount / allOrdersInRange.length) * 100) : 0;

    document.getElementById('kpi-revenue').innerText = `$${totalRevenue.toLocaleString()}`;
    document.getElementById('kpi-count').innerText = orderCount;
    document.getElementById('kpi-avg').innerText = `$${avgOrderValue.toLocaleString()}`;
    document.getElementById('kpi-rate').innerText = `${completionRate}%`;

    // Clarify Logistics description based on scope
    const logDesc = document.getElementById('logistics-description');
    if (logDesc) {
        logDesc.innerText = viewMode === 'single' ?
            `分析 ${selYear}/${selMonth} 整個月內，週一至週日的配送量分布` :
            `分析 ${selYear} 全年度內，週一至週日的配送量總和分布`;
    }

    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    reportOrders.sort((a, b) => window.safeParseDate(a.timestamp).getTime() - window.safeParseDate(b.timestamp).getTime());

    // 1. DELIVERY CHART AGGREGATION
    const deliveryData = {};
    const dConf = window.chartConfigs.delivery;
    const dTime = viewMode === 'trend' ? 'all' : dConf.time; // Show all orders in year if in trend mode
    reportOrders.forEach(o => {
        const d = window.safeParseDate(o.timestamp);
        if (!timeFilterPassed(d, dTime, cutoffDateEnd)) return;
        const itemsInfo = parseOrderItemsRobust(o);
        if (dConf.cat === 'profile' && itemsInfo.countProfile === 0) return;
        if (dConf.cat === 'accessory' && itemsInfo.countAccessory === 0) return;

        const deliv = o.address || "未填寫";
        let delivType = "其他";
        if (deliv.includes('自取')) delivType = "自取";
        else if (deliv.includes('店到店')) delivType = "超商店到店";
        else if (deliv.includes('宅配')) delivType = "貨運宅配";
        else if (deliv.includes('公司配送') || deliv.includes('專車')) delivType = "公司配送";

        if (!deliveryData[delivType]) deliveryData[delivType] = 0;
        deliveryData[delivType]++;
    });

    // 2. SERIES PIE CHART AGGREGATION
    const seriesData = { '20 系列': 0, '30 系列': 0, '40 系列': 0 };
    const sConf = window.chartConfigs.series;
    const sTime = viewMode === 'trend' ? 'all' : sConf.time;
    reportOrders.forEach(o => {
        const d = window.safeParseDate(o.timestamp);
        if (!timeFilterPassed(d, sTime, cutoffDateEnd)) return;

        const itemsInfo = parseOrderItemsRobust(o);
        let totalSeriesCount = itemsInfo.count20 + itemsInfo.count30 + itemsInfo.count40 + itemsInfo.countOther;
        if (totalSeriesCount === 0) totalSeriesCount = 1;

        let validRatio = 1.0;
        if (sConf.cat === 'profile') {
            if (itemsInfo.countProfile + itemsInfo.countAccessory > 0) validRatio = itemsInfo.countProfile / (itemsInfo.countProfile + itemsInfo.countAccessory);
            else validRatio = 0;
        } else if (sConf.cat === 'accessory') {
            if (itemsInfo.countProfile + itemsInfo.countAccessory > 0) validRatio = itemsInfo.countAccessory / (itemsInfo.countProfile + itemsInfo.countAccessory);
            else validRatio = 0;
        }
        const assignedValue = window.safeParsePrice(o.total) * validRatio;

        seriesData['20 系列'] += assignedValue * (itemsInfo.count20 / totalSeriesCount);
        seriesData['30 系列'] += assignedValue * (itemsInfo.count30 / totalSeriesCount);
        seriesData['40 系列'] += assignedValue * (itemsInfo.count40 / totalSeriesCount);
    });

    // 3. TOP 10 ITEMS AGGREGATION
    const top10Map = {};
    const topItemsColorMap = {};
    const tConf = window.chartConfigs.top10;
    const tTime = viewMode === 'trend' ? 'all' : tConf.time;
    reportOrders.forEach(o => {
        const d = window.safeParseDate(o.timestamp);
        if (!timeFilterPassed(d, tTime, cutoffDateEnd)) return;

        const itemsInfo = parseOrderItemsRobust(o);

        Object.keys(itemsInfo.itemsMapTotal).forEach(key => {
            let isProfileFlag = itemsInfo.paramMap[key].isProfile;
            if (tConf.cat === 'profile' && !isProfileFlag) return;
            if (tConf.cat === 'accessory' && isProfileFlag) return;

            if (!top10Map[key]) top10Map[key] = 0;
            top10Map[key] += itemsInfo.itemsMapTotal[key];

            // [同步配色邏輯] 讓 Top 10 圖表也能認出 [M8-XXX] 等新格式並塗上正確的莫蘭迪色
            let cleanName = key;
            let s = window.detectSeries(cleanName);
            let color = '#b3c7d9'; // 默認 20系列 (莫蘭迪藍)
            if (s === 30) color = '#c6a682'; // 30系列 (莫蘭迪橘)
            else if (s === 40) color = '#b8ccb8'; // 40系列 (莫蘭迪綠)
            topItemsColorMap[key] = color;
        });
    });

    const topItems = Object.entries(top10Map)
        .map(([name, qty]) => { return { label: name, value: parseFloat(qty.toFixed(2)), color: topItemsColorMap[name] }; })
        .filter(item => item.label.length > 1)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

    // 4. REVENUE TREND AGGREGATION
    const monthlyDataTotal = {};
    const monthlyDataProfile = {};
    const monthlyDataAccessory = {};
    const monthlyDataFinished = {};
    const trConf = window.chartConfigs.trend;
    const smConf = window.chartConfigs.seriesMix || { time: 'month' };
    const logConf = window.chartConfigs.logistics || { time: 'month' };

    // --- NEW CHARTS DATA STRUCTURES ---
    const seriesMixData = { '20系列': {}, '30系列': {}, '40系列': {} };
    const crossSellData = { profileLength: {}, accessoryCount: {} };
    const logisticsData = { '週一': {}, '週二': {}, '週三': {}, '週四': {}, '週五': {}, '週六': {}, '週日': {} };

    // Initialize Logistics categories
    const rDays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    rDays.forEach(d => {
        logisticsData[d]['公司配送'] = 0;
        logisticsData[d]['自取'] = 0;
        logisticsData[d]['一般貨運'] = 0;
    });

    // Init trend chart time keys
    if (trConf.time === 'day') {
        const daysInMonth = new Date(selYear, selMonth, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            let mKey = `${selMonth}/${i}`;
            monthlyDataTotal[mKey] = 0;
            monthlyDataProfile[mKey] = 0;
            monthlyDataAccessory[mKey] = 0;
            monthlyDataFinished[mKey] = 0;
        }
    } else if (trConf.time === 'week') {
        const daysInMonth = new Date(selYear, selMonth, 0).getDate();
        const maxWeek = Math.ceil(daysInMonth / 7);
        for (let i = 1; i <= maxWeek; i++) {
            let wKey = `第${i}週`;
            monthlyDataTotal[wKey] = 0;
            monthlyDataProfile[wKey] = 0;
            monthlyDataAccessory[wKey] = 0;
            monthlyDataFinished[wKey] = 0;
        }
    } else {
        // Trend / Year Mode: Init all 12 months
        for (let i = 1; i <= 12; i++) {
            let mKey = `${selYear % 100}年${i}月`;
            monthlyDataTotal[mKey] = 0;
            monthlyDataProfile[mKey] = 0;
            monthlyDataAccessory[mKey] = 0;
            monthlyDataFinished[mKey] = 0;
        }
    }

    // Init seriesMix + crossSell time keys
    if (smConf.time === 'day') {
        const daysInMonth = new Date(selYear, selMonth, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            let mKey = `${selMonth}/${i}`;
            ['20系列', '30系列', '40系列'].forEach(s => seriesMixData[s][mKey] = 0);
            crossSellData.profileLength[mKey] = 0;
            crossSellData.accessoryCount[mKey] = 0;
        }
    } else if (smConf.time === 'week') {
        const daysInMonth = new Date(selYear, selMonth, 0).getDate();
        const maxWeek = Math.ceil(daysInMonth / 7);
        for (let i = 1; i <= maxWeek; i++) {
            let wKey = `第${i}週`;
            ['20系列', '30系列', '40系列'].forEach(s => seriesMixData[s][wKey] = 0);
            crossSellData.profileLength[wKey] = 0;
            crossSellData.accessoryCount[wKey] = 0;
        }
    } else {
        // Yearly trend for seriesMix
        for (let i = 1; i <= 12; i++) {
            let mKey = `${selYear % 100}年${i}月`;
            ['20系列', '30系列', '40系列'].forEach(s => seriesMixData[s][mKey] = 0);
            crossSellData.profileLength[mKey] = 0;
            crossSellData.accessoryCount[mKey] = 0;
        }
    }

    reportOrders.forEach(o => {
        const oDate = window.safeParseDate(o.timestamp);
        const price = window.safeParsePrice(o.total);
        const itemsInfo = parseOrderItemsRobust(o);

        let totalItemsCount = itemsInfo.countProfile + itemsInfo.countAccessory + itemsInfo.countFinished;
        if (totalItemsCount === 0) totalItemsCount = 1;
        let pRatio = itemsInfo.countProfile / totalItemsCount;
        let aRatio = itemsInfo.countAccessory / totalItemsCount;
        let fRatio = itemsInfo.countFinished / totalItemsCount;

        // Series Mix logic
        let totalSeriesCount = itemsInfo.count20 + itemsInfo.count30 + itemsInfo.count40 + itemsInfo.countOther;
        if (totalSeriesCount === 0) totalSeriesCount = 1;
        let p20 = price * (itemsInfo.count20 / totalSeriesCount);
        let p30 = price * (itemsInfo.count30 / totalSeriesCount);
        let p40 = price * (itemsInfo.count40 / totalSeriesCount);
        let pAcc = price * (itemsInfo.countOther / totalSeriesCount); // Assuming 'other' mostly means accessories in this split

        // Cross Sell logic - we need raw lengths vs qty
        let totalProfileLength = 0; // rough cm estimation for cross sell chart
        let totalAccQty = 0;
        Object.keys(itemsInfo.itemsMapTotal).forEach(key => {
            const param = itemsInfo.paramMap[key];
            if (param.isProfile) {
                // Try to guess length from name, or default if missing
                const lenMatch = key.match(/(\d+(?:\.\d+)?)\s*cm/i);
                if (lenMatch) totalProfileLength += parseFloat(lenMatch[1]) * itemsInfo.itemsMapTotal[key];
                else totalProfileLength += 100 * itemsInfo.itemsMapTotal[key]; // fallback assumption
            } else {
                totalAccQty += itemsInfo.itemsMapTotal[key];
            }
        });

        // Logistics logic (Uses the already pre-filtered reportOrders)
        const logTime = viewMode === 'trend' ? 'all' : logConf.time;
        if (timeFilterPassed(oDate, logTime, cutoffDateEnd)) {
            const dayStr = rDays[oDate.getDay()];
            const deliv = o.address || "未填寫";
            let delivType = "一般貨運";
            if (deliv.includes('自取')) delivType = "自取";
            else if (deliv.includes('公司配送') || deliv.includes('專車')) delivType = "公司配送";
            logisticsData[dayStr][delivType]++;
        }

        let timeKey = "";
        if (trConf.time === 'day') {
            if (oDate.getFullYear() === selYear && (oDate.getMonth() + 1) === selMonth) {
                timeKey = `${selMonth}/${oDate.getDate()}`;
            }
        } else if (trConf.time === 'week') {
            if (oDate.getFullYear() === selYear && (oDate.getMonth() + 1) === selMonth) {
                let wNum = Math.ceil(oDate.getDate() / 7);
                timeKey = `第${wNum}週`;
            }
        } else {
            // Yearly mode
            if (oDate.getFullYear() === selYear) {
                timeKey = `${oDate.getFullYear() % 100}年${oDate.getMonth() + 1}月`;
            }
        }

        if (timeKey && monthlyDataTotal[timeKey] !== undefined) {
            monthlyDataTotal[timeKey] += price;
            monthlyDataProfile[timeKey] += price * pRatio;
            monthlyDataAccessory[timeKey] += price * aRatio;
            monthlyDataFinished[timeKey] += price * fRatio;
        }

        // SeriesMix + CrossSell aggregation
        let smTimeKey = "";
        if (smConf.time === 'day') {
            if (oDate.getFullYear() === selYear && (oDate.getMonth() + 1) === selMonth)
                smTimeKey = `${selMonth}/${oDate.getDate()}`;
        } else if (smConf.time === 'week') {
            if (oDate.getFullYear() === selYear && (oDate.getMonth() + 1) === selMonth)
                smTimeKey = `第${Math.ceil(oDate.getDate() / 7)}週`;
        } else {
            if (oDate.getFullYear() === selYear)
                smTimeKey = `${oDate.getFullYear() % 100}年${oDate.getMonth() + 1}月`;
        }
        if (smTimeKey && seriesMixData['20系列'][smTimeKey] !== undefined) {
            seriesMixData['20系列'][smTimeKey] += p20;
            seriesMixData['30系列'][smTimeKey] += p30;
            seriesMixData['40系列'][smTimeKey] += p40;
            crossSellData.profileLength[smTimeKey] += totalProfileLength;
            crossSellData.accessoryCount[smTimeKey] += totalAccQty;
        }
    });

    try {
        if (typeof Chart !== 'undefined') {
            Object.values(chartsInstance).forEach(chart => {
                if (chart && typeof chart.destroy === 'function') chart.destroy();
            });

            // Global Chart.js Defaults for Light Theme
            Chart.defaults.color = '#545454';
            Chart.defaults.borderColor = '#e5e5e5';
            Chart.defaults.font.family = "'Noto Sans TC', sans-serif";

            // TREND CHART
            const ctxTrend = document.getElementById('chart-revenue-trend');
            if (ctxTrend) {
                let trSets = [];
                if (trConf.cat === 'all' || trConf.cat === 'profile') {
                    trSets.push({
                        label: '鋁材營收',
                        data: Object.values(monthlyDataProfile).map(v => Math.round(v)),
                        backgroundColor: 'rgba(179,199,217,0.55)', // Morandi Slate Blue
                        borderRadius: trConf.cat === 'all' ? { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 } : 4,
                        borderSkipped: false
                    });
                }
                if (trConf.cat === 'all' || trConf.cat === 'accessory') {
                    trSets.push({
                        label: '配件營收',
                        data: Object.values(monthlyDataAccessory).map(v => Math.round(v)),
                        backgroundColor: '#ba8181', // Morandi Rose
                        borderRadius: trConf.cat === 'all' ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 4,
                        borderSkipped: false
                    });
                }
                if (trConf.cat === 'all' || trConf.cat === 'finished') {
                    trSets.push({
                        label: '自家成品營收',
                        data: Object.values(monthlyDataFinished).map(v => Math.round(v)),
                        backgroundColor: 'rgba(142,68,173,0.55)', // 自家成品 紫（與訂單標籤同色系）
                        borderRadius: trConf.cat === 'all' ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 4,
                        borderSkipped: false
                    });
                }

                
            // === 深色主題 Chart.js 全域設定 ===
            Chart.defaults.color = 'rgba(255,255,255,0.6)';
            Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';
            Chart.defaults.plugins.legend.labels.color = 'rgba(255,255,255,0.5)';

                chartsInstance.trend = new Chart(ctxTrend, {
                    type: 'bar',
                    data: { labels: Object.keys(monthlyDataTotal), datasets: trSets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: true, position: 'top', labels: { color: '#a0aec0', boxWidth: 12, font: { size: 10 } } },
                            tooltip: {
                                callbacks: {
                                    footer: (tooltipItems) => {
                                        let t = 0;
                                        tooltipItems.forEach(i => t += i.parsed.y);
                                        return '總營收: ' + t.toLocaleString() + ' 元';
                                    }
                                }
                            }
                        },
                        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
                    }
                });
            }

            // NEW CHART 1: SERIES MIX (Stacked Area/Bar)
            const ctxSeriesMix = document.getElementById('chart-series-mix');
            if (ctxSeriesMix) {
                chartsInstance.seriesMix = new Chart(ctxSeriesMix, {
                    type: 'bar',
                    data: {
                        labels: Object.keys(seriesMixData['20系列']),
                        datasets: [
                            { label: '20系列', data: Object.values(seriesMixData['20系列']).map(v => Math.round(v)), backgroundColor: '#c8d8e8', borderRadius: { topLeft: 0, topRight: 0 } },
                            { label: '30系列', data: Object.values(seriesMixData['30系列']).map(v => Math.round(v)), backgroundColor: 'rgba(198,166,130,0.55)' },
                            { label: '40系列', data: Object.values(seriesMixData['40系列']).map(v => Math.round(v)), backgroundColor: 'rgba(184,204,184,0.55)', borderRadius: { topLeft: 4, topRight: 4 } }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'top', labels: { boxWidth: 12, usePointStyle: true } } },
                        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
                    }
                });
            }

            // NEW CHART 2: CROSS SELL (Combo)
            const ctxCrossSell = document.getElementById('chart-cross-sell');
            if (ctxCrossSell) {
                chartsInstance.crossSell = new Chart(ctxCrossSell, {
                    type: 'bar',
                    data: {
                        labels: Object.keys(crossSellData.profileLength),

                        datasets: [
                            {
                                type: 'line',
                                label: '搭售配件數',
                                data: Object.values(crossSellData.accessoryCount),
                                borderColor: '#ba8181', // Rose
                                backgroundColor: '#ba8181',
                                borderWidth: 2,
                                tension: 0.3,
                                yAxisID: 'y1'
                            },
                            {
                                type: 'bar',
                                label: '鋁材出貨長度 (cm)',
                                data: Object.values(crossSellData.profileLength),
                                backgroundColor: '#a3bcbd', // Sage Green
                                borderRadius: 4,
                                yAxisID: 'y'
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
                        scales: {
                            x: { grid: { display: false } },
                            y: { type: 'linear', display: true, position: 'left', title: { display: true, text: '長度 (cm)', color: '#888' } },
                            y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '配件數量 (個)', color: '#ba8181' } }
                        }
                    }
                });
            }

            // NEW CHART 3: LOGISTICS HEATMAP (Grouped Bar)
            const ctxLogistics = document.getElementById('chart-logistics');
            if (ctxLogistics) {
                const lLabels = Object.keys(logisticsData);
                const dCorp = lLabels.map(l => logisticsData[l]['公司配送']);
                const dSelf = lLabels.map(l => logisticsData[l]['自取']);
                const dGen = lLabels.map(l => logisticsData[l]['一般貨運']);

                chartsInstance.logistics = new Chart(ctxLogistics, {
                    type: 'bar',
                    data: {
                        labels: lLabels,
                        datasets: [
                            { label: '公司配送 (車趟壓力)', data: dCorp, backgroundColor: '#c2a3a3', borderRadius: 4 },
                            { label: '客戶自取', data: dSelf, backgroundColor: '#bcaaa4', borderRadius: 4 },
                            { label: '一般貨運', data: dGen, backgroundColor: '#94a3b8', borderRadius: 4 }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
                        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: '訂單數' } } }
                    }
                });
            }

            // PIE CHART: SERIES
            const ctxSeries = document.getElementById('chart-series-pie');
            if (ctxSeries) {
                let sVals = Object.values(seriesData);
                let sSum = sVals.reduce((a, b) => a + b, 0);
                let sLabels = Object.keys(seriesData).map((k, i) => {
                    let pct = sSum > 0 ? Math.round((sVals[i] / sSum) * 100) : 0;
                    return `${k} (${pct}%)`;
                });

                chartsInstance.series = new Chart(ctxSeries, {
                    type: 'doughnut',
                    data: {
                        labels: sLabels,
                        datasets: [{ data: sVals, backgroundColor: ['#b3c7d9', '#c6a682', '#b8ccb8'], borderWidth: 0 }]
                    },
                    options: {
                        responsive: true, cutout: '65%',
                        plugins: { legend: { position: 'right', labels: { color: '#545454', font: { size: 12 } } } }
                    }
                });
            }

            // PIE CHART: DELIVERY
            const ctxDelivery = document.getElementById('chart-delivery-pie');
            if (ctxDelivery) {
                chartsInstance.delivery = new Chart(ctxDelivery, {
                    type: 'pie',
                    data: {
                        labels: Object.keys(deliveryData),
                        datasets: [{
                            data: Object.values(deliveryData),
                            backgroundColor: ['#a3a3c2', '#c2a3a3', '#8ca3a3', '#94a3b8', '#bcaaa4'],
                            borderWidth: 0
                        }]
                    },
                    options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#545454' } } } }
                });
            }

            // BAR CHART: TOP 10
            const ctxTop = document.getElementById('chart-top-items');
            if (ctxTop) {
                chartsInstance.top = new Chart(ctxTop, {
                    type: 'bar',
                    data: {
                        labels: topItems.map(item => item.label),
                        datasets: [{
                            label: '銷售總量',
                            data: topItems.map(item => item.value),
                            backgroundColor: topItems.map(item => item.color),
                            borderRadius: 4
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                        plugins: { legend: { display: false } },
                        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { ticks: { autoSkip: false } } }
                    }
                });
            }
        }
    } catch (e) {
        console.error("Render Chart Error: ", e);
    }
};

window.onload = function () {
    // 1. Start 3D Cityscape Background Immediately (Global Layer)
    if (typeof initThreeJsScene === 'function') {
        initThreeJsScene();
    }

    // 2. Initial Data Fetch & Login Check
    if (sessionStorage.getItem('admin_logged_in') === 'true') {
        showAdminHub();
    } else {
        const loginOverlay = document.getElementById('login-overlay');
        if (loginOverlay) loginOverlay.classList.remove('hidden');
    }

    // 3. Update Hub Clock
    setInterval(() => {
        const hubTime = document.getElementById('hub-datetime');
        if (hubTime) {
            const now = new Date();
            hubTime.innerText = now.toLocaleString('zh-TW', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });
        }
    }, 1000);
};/* ============================================================
   ALUMIBRO Calendar Module
   ============================================================ */

// 全域狀態
window.calendarState = {
    currentDate: new Date(),         // 目前顯示的月份
    selectedDate: null,              // 選中的日期（YYYY-MM-DD）
    events: [],                      // 所有事件
    members: [],                     // 所有人員（從 Sheets 載入）
    editingEventId: null             // 正在編輯的事件 ID
};

// 類別配色（深色版）
window.eventTypeColors = {
    '出差':     { bg: 'rgba(212,160,160,0.35)', text: '#f0c4c4', border: 'rgba(212,160,160,0.5)' },
    '丈量':     { bg: 'rgba(220,196,160,0.35)', text: '#f2dcb6', border: 'rgba(220,196,160,0.5)' },
    '施工':     { bg: 'rgba(198,166,130,0.35)', text: '#dcc4a0', border: 'rgba(198,166,130,0.5)' },
    '出車':     { bg: 'rgba(168,196,168,0.35)', text: '#ccdccc', border: 'rgba(168,196,168,0.5)' },
    '客戶來訪': { bg: 'rgba(160,188,212,0.35)', text: '#c0d4e8', border: 'rgba(160,188,212,0.5)' },
    '內部會議': { bg: 'rgba(179,199,217,0.35)', text: '#c8d8e8', border: 'rgba(179,199,217,0.5)' },
    '外部會議': { bg: 'rgba(184,204,184,0.35)', text: '#ccdccc', border: 'rgba(184,204,184,0.5)' },
    '事假':     { bg: 'rgba(188,170,164,0.35)', text: '#e2cdbd', border: 'rgba(188,170,164,0.5)' },
    '特休':     { bg: 'rgba(218,178,178,0.35)', text: '#f5d6d6', border: 'rgba(218,178,178,0.5)' },
    '病假':     { bg: 'rgba(186,129,129,0.35)', text: '#f0c4c4', border: 'rgba(186,129,129,0.5)' },
    '喪假':     { bg: 'rgba(140,140,140,0.35)', text: '#cccccc', border: 'rgba(140,140,140,0.5)' },
    '員旅':     { bg: 'rgba(176,196,176,0.35)', text: '#d4e0d4', border: 'rgba(176,196,176,0.5)' },
    '國定假日': { bg: 'rgba(212,160,160,0.45)', text: '#fbe0e0', border: 'rgba(212,160,160,0.6)' }
};


// ===== 「你是誰？」對話框 =====
window.getCurrentUser = function () {
    return localStorage.getItem('admin_current_user') || '';
};

window.setCurrentUser = function (name) {
    localStorage.setItem('admin_current_user', name);
};

window.showWhoModal = function () {
    const modal = document.getElementById('who-modal');
    const listEl = document.getElementById('who-members-list');
    if (!modal || !listEl) return;

    if (!window.calendarState.members || window.calendarState.members.length === 0) {
        // 還沒載入人員，先載入
        fetchCalendarMembers().then(() => window.showWhoModal());
        return;
    }

    const current = window.getCurrentUser();
    listEl.innerHTML = window.calendarState.members.map(name => {
        const active = current === name ? 'background:rgba(198,166,130,0.3); border-color:rgba(198,166,130,0.6); color:#f2dcb6;' : 'background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.15); color:rgba(255,255,255,0.85);';
        return `<button onclick="selectAdminUser('${name.replace(/'/g, "\\'")}')" style="${active} padding:8px 16px; border-radius:8px; cursor:pointer; font-size:0.9rem;">${name}</button>`;
    }).join('');

    modal.style.display = 'flex';
};

window.selectAdminUser = function (name) {
    window.setCurrentUser(name);
    document.getElementById('who-modal').style.display = 'none';
    console.log('[Calendar] Current user set to:', name);
};


// ===== API: 取得人員清單 =====
window.fetchCalendarMembers = async function () {
    try {
        const res = await fetch(ADMIN_API_URL + "?action=getCalendarMembers&t=" + new Date().getTime());
        const data = await res.json();
        if (data.ok && Array.isArray(data.members)) {
            window.calendarState.members = data.members;
            console.log('[Calendar] Loaded members:', data.members);
        } else {
            console.warn('[Calendar] Members fetch failed:', data.error);
            window.calendarState.members = [];
        }
    } catch (e) {
        console.error('[Calendar] Members fetch error:', e);
        window.calendarState.members = [];
    }
};


// ===== API: 取得所有行程 =====
window.fetchCalendarEvents = async function () {
    try {
        const res = await fetch(ADMIN_API_URL + "?action=getCalendarEvents&t=" + new Date().getTime());
        const data = await res.json();
        if (data.ok && Array.isArray(data.events)) {
            window.calendarState.events = data.events;
            console.log('[Calendar] Loaded events:', data.events.length);
        } else {
            console.warn('[Calendar] Events fetch failed:', data.error);
            window.calendarState.events = [];
        }
        renderCalendar();
        renderEventList();
        updateHubCalendarPreview();
    } catch (e) {
        console.error('[Calendar] Events fetch error:', e);
        window.calendarState.events = [];
    }
};


// ===== 月份切換 =====
window.changeCalMonth = function (delta) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        // 手機版：以週為單位移動
        const d = window.calendarState.currentDate;
        d.setDate(d.getDate() + delta * 7);
        window.calendarState.currentDate = new Date(d);
    } else {
        // 桌面版：以月為單位
        const d = window.calendarState.currentDate;
        window.calendarState.currentDate = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    }
    renderCalendar();
};


// ===== 渲染月曆網格（自動判斷桌面/手機） =====
window.renderCalendar = function () {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        renderWeekCalendar();
        renderAgendaList();
    } else {
        renderMonthCalendar();
    }
};


// ===== 手機週曆 + agenda =====
window.renderWeekCalendar = function () {
    const grid = document.getElementById('cal-days');
    const title = document.getElementById('cal-month-title');
    if (!grid || !title) return;

    // 計算當前週的週日（起點）
    const cur = new Date(window.calendarState.currentDate);
    const weekStart = new Date(cur);
    weekStart.setDate(cur.getDate() - cur.getDay()); // 退到本週日

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const fmtFull = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    // 計算是第幾週
    const yearStart = new Date(weekStart.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((weekStart - yearStart) / 86400000 + yearStart.getDay() + 1) / 7);
    
    title.innerHTML = `${fmt(weekStart)} — ${fmt(weekEnd)}<div style="font-size:10px; color:rgba(255,255,255,0.4); margin-top:2px; font-weight:normal;">${weekStart.getFullYear()} 年 ${weekStart.getMonth() + 1} 月 · 第 ${weekNum} 週</div>`;

    const today = new Date();
    const todayStr = fmtFull(today);
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

    let html = '';
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const dStr = fmtFull(d);
        const isToday = dStr === todayStr;
        const isSelected = dStr === window.calendarState.selectedDate;
        const events = getEventsForDate(dStr);
        const dotColor = events.length > 0 ? (window.eventTypeColors[events[0].type]?.border || 'rgba(220,196,160,0.7)') : 'transparent';
        const dotsHTML = events.length > 0 ? `<div style="display:flex; gap:2px; justify-content:center; margin-top:3px;">${events.slice(0, 3).map(ev => {
            const c = window.eventTypeColors[ev.type] || window.eventTypeColors['內部會議'];
            return `<div style="width:4px; height:4px; border-radius:50%; background:${c.border};"></div>`;
        }).join('')}${events.length > 3 ? `<div style="font-size:8px; color:rgba(255,255,255,0.5); line-height:1;">+</div>` : ''}</div>` : `<div style="height:6px;"></div>`;

        const bg = isToday ? 'background:rgba(198,166,130,0.18); border:1px solid rgba(198,166,130,0.4);' : (isSelected ? 'background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.2);' : 'border:1px solid transparent;');
        const dateColor = isToday ? '#f2dcb6' : 'rgba(255,255,255,0.85)';
        const wkColor = isToday ? '#dcc4a0' : 'rgba(255,255,255,0.45)';

        html += `<div onclick="selectCalDay('${dStr}')" style="${bg} text-align:center; padding:6px 2px; border-radius:6px; cursor:pointer;">
            <div style="font-size:10px; color:${wkColor};">${weekDays[i]}</div>
            <div style="font-size:14px; color:${dateColor}; font-weight:${isToday ? '500' : '400'}; margin-top:2px;">${d.getDate()}</div>
            ${dotsHTML}
        </div>`;
    }

    // 改 grid layout 為 7 欄並排
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    grid.style.gridTemplateRows = 'auto';
    grid.style.gap = '4px';
    grid.innerHTML = html;
};


// ===== 手機 agenda 列表（未來 N 天）=====
window.renderAgendaList = function () {
    // 在月曆下方注入或更新 agenda 區塊
    const calLeft = document.querySelector('.calendar-left');
    if (!calLeft) return;

    let agendaEl = document.getElementById('cal-agenda-list');
    if (!agendaEl) {
        agendaEl = document.createElement('div');
        agendaEl.id = 'cal-agenda-list';
        agendaEl.style.cssText = 'margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08);';
        calLeft.appendChild(agendaEl);
    }

    // 取出本週起算後 30 天內所有事件（含跨日）
    const cur = new Date(window.calendarState.currentDate);
    const weekStart = new Date(cur);
    weekStart.setDate(cur.getDate() - cur.getDay());

    const events = window.calendarState.events || [];
    // 按開始日期排序
    const sorted = events.slice().sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    // 只取結束日 >= 本週開始的事件（不顯示過期太久的）
    const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
    const upcoming = sorted.filter(ev => (ev.endDate || ev.startDate) >= weekStartStr).slice(0, 20);

    if (upcoming.length === 0) {
        agendaEl.innerHTML = `<div style="text-align:center; color:rgba(255,255,255,0.4); padding:20px; font-size:0.85rem;">
            <i class="far fa-calendar" style="display:block; font-size:1.5rem; margin-bottom:8px; opacity:0.5;"></i>
            未來無排程
        </div>`;
        return;
    }

    let html = `<div style="font-size:11px; color:rgba(255,255,255,0.45); margin-bottom:8px; padding-left:2px;">即將到來</div>`;
    let lastDate = null;

    upcoming.forEach(ev => {
        const c = window.eventTypeColors[ev.type] || window.eventTypeColors['內部會議'];
        const isCrossDay = ev.startDate !== ev.endDate;
        const dateLabel = isCrossDay
            ? `${ev.startDate.slice(5).replace('-', '/')}—${ev.endDate.slice(5).replace('-', '/')}`
            : ev.startDate.slice(5).replace('-', '/');

        // Date header (只在換日時顯示)
        if (ev.startDate !== lastDate) {
            const [y, m, d] = ev.startDate.split('-');
            const dobj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
            const wk = ['日', '一', '二', '三', '四', '五', '六'][dobj.getDay()];
            html += `<div style="font-size:11px; color:rgba(255,255,255,0.5); margin:8px 0 4px; font-weight:500;">${parseInt(m)}/${parseInt(d)} ${wk}</div>`;
            lastDate = ev.startDate;
        }

        const membersHTML = (ev.members && ev.members.length > 0)
            ? `<div style="display:flex; flex-wrap:wrap; gap:3px; margin-top:5px;">${ev.members.map(m => `<span style="background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.8); padding:1px 7px; border-radius:99px; border:1px solid rgba(255,255,255,0.12); font-size:10px;">${m}</span>`).join('')}</div>`
            : `<div style="font-size:10px; color:rgba(255,255,255,0.3); margin-top:3px; font-style:italic;">未指定人員</div>`;

        html += `<div onclick="showEditEventModal('${ev.id}')" style="background:rgba(36,48,57,0.6); border:1px solid rgba(255,255,255,0.06); border-left:3px solid ${c.border}; border-radius:6px; padding:8px 10px; margin-bottom:5px; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                <span style="background:${c.bg}; color:${c.text}; padding:1px 6px; border-radius:99px; font-size:9px; border:1px solid ${c.border};">${ev.type}</span>
                <span style="font-size:10px; color:rgba(255,255,255,0.45);">${dateLabel}</span>
            </div>
            <div style="font-size:0.88rem; color:rgba(255,255,255,0.92); font-weight:500; margin-bottom:2px;">${ev.title || '(未命名)'}</div>
            ${membersHTML}
            ${ev.notes ? `<div style="font-size:0.7rem; color:rgba(255,255,255,0.5); margin-top:5px; padding-top:5px; border-top:1px dashed rgba(255,255,255,0.06);">${ev.notes.replace(/\n/g, '<br>')}</div>` : ''}
        </div>`;
    });

    agendaEl.innerHTML = html;
};


// ===== 桌面版月曆 (原本的 renderCalendar 改名) =====
window.renderMonthCalendar = function () {
    const grid = document.getElementById('cal-days');
    const title = document.getElementById('cal-month-title');
    if (!grid || !title) return;

    const d = window.calendarState.currentDate;
    const year = d.getFullYear();
    const month = d.getMonth();
    title.textContent = `${year} 年 ${month + 1} 月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    let html = '';

    // 上月填白
    for (let i = firstDay - 1; i >= 0; i--) {
        const dayNum = prevMonthDays - i;
        html += `<div class="cal-day empty"><span class="date-num" style="opacity:0.3;">${dayNum}</span></div>`;
    }

    // 本月日期
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === window.calendarState.selectedDate;
        const dayEvents = getEventsForDate(dateStr);

        const classes = ['cal-day'];
        if (isToday) classes.push('today');
        if (isSelected) classes.push('active');

        let eventHTML = '';
        if (dayEvents.length > 0) {
            // 最多顯示 3 條 + 「+N 更多」
            const maxShow = 3;
            const showList = dayEvents.slice(0, maxShow);
            const more = dayEvents.length - maxShow;
            eventHTML = showList.map(ev => {
                const c = window.eventTypeColors[ev.type] || window.eventTypeColors['內部會議'];
                const memberStr = (ev.members && ev.members.length > 0) ? ev.members.slice(0, 2).join(' ') : '';
                const label = ev.title || ev.type;
                return `<div class="cal-event-bar" style="background:${c.bg}; color:${c.text}; border:1px solid ${c.border};" title="${ev.type}: ${ev.title || ''} (${(ev.members||[]).join(', ')})">${memberStr ? `<span style="opacity:0.85;">${memberStr}</span> ` : ''}${label}</div>`;
            }).join('');
            if (more > 0) {
                eventHTML += `<div style="font-size:0.65rem; color:rgba(255,255,255,0.5); margin-top:2px; padding-left:5px;">+${more} 更多</div>`;
            }
        }

        html += `<div class="${classes.join(' ')}" onclick="selectCalDay('${dateStr}')">
            <span class="date-num">${day}</span>
            <div class="cal-events-wrap">${eventHTML}</div>
        </div>`;
    }

    // 下月填白（補到 6 列 × 7 = 42 格）
    const totalCells = firstDay + daysInMonth;
    const fillCount = (totalCells % 7 === 0) ? 0 : (7 - totalCells % 7);
    for (let i = 1; i <= fillCount; i++) {
        html += `<div class="cal-day empty"><span class="date-num" style="opacity:0.3;">${i}</span></div>`;
    }

    grid.innerHTML = html;
};


// ===== 取得某日期的所有事件（跨日的也算）=====
window.getEventsForDate = function (dateStr) {
    return window.calendarState.events.filter(ev => {
        const start = ev.startDate;
        const end = ev.endDate || ev.startDate;
        return dateStr >= start && dateStr <= end;
    });
};


// ===== 點選日期 =====
window.selectCalDay = function (dateStr) {
    window.calendarState.selectedDate = dateStr;
    renderCalendar();
    renderEventList();
};


// ===== 渲染右側事件列表 =====
window.renderEventList = function () {
    const titleEl = document.getElementById('cal-selected-date-title');
    const listEl = document.getElementById('cal-event-list');
    if (!titleEl || !listEl) return;

    const dateStr = window.calendarState.selectedDate;
    if (!dateStr) {
        titleEl.textContent = '請選擇日期';
        listEl.innerHTML = '<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">請點擊左側日期查看行程</div>';
        return;
    }

    const [y, m, d] = dateStr.split('-');
    const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const weekDay = ['日', '一', '二', '三', '四', '五', '六'][dateObj.getDay()];
    const events = getEventsForDate(dateStr);

    titleEl.innerHTML = `${parseInt(m)}/${parseInt(d)} 行程
        <div style="font-size:0.75rem; color:rgba(255,255,255,0.4); margin-top:4px; font-weight:normal;">星期${weekDay} · 共 ${events.length} 筆</div>`;

    if (events.length === 0) {
        listEl.innerHTML = `<div style="padding:40px; text-align:center; color:rgba(255,255,255,0.4);">
            <i class="far fa-calendar" style="font-size:2rem; margin-bottom:10px; display:block; opacity:0.5;"></i>
            這天沒有行程
            <button onclick="showAddEventModal('${dateStr}')" style="display:block; margin:14px auto 0; background:rgba(198,166,130,0.2); border:1px solid rgba(198,166,130,0.4); color:#dcc4a0; padding:6px 14px; border-radius:8px; cursor:pointer; font-size:0.85rem;">+ 新增行程</button>
        </div>`;
        return;
    }

    listEl.innerHTML = events.map(ev => {
        const c = window.eventTypeColors[ev.type] || window.eventTypeColors['內部會議'];
        const isCrossDay = ev.startDate !== ev.endDate;
        const dateLabel = isCrossDay ? `${ev.startDate.slice(5).replace('-', '/')} — ${ev.endDate.slice(5).replace('-', '/')}` : ev.startDate.slice(5).replace('-', '/');
        const membersHTML = (ev.members || []).map(m => `<span style="background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.85); padding:1px 8px; border-radius:99px; border:1px solid rgba(255,255,255,0.12); font-size:0.7rem;">${m}</span>`).join('');

        return `<div class="event-card" style="background:rgba(36,48,57,0.7); border:1px solid rgba(255,255,255,0.08); border-left:3px solid ${c.border}; border-radius:8px; padding:12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="background:${c.bg}; color:${c.text}; padding:2px 8px; border-radius:99px; border:1px solid ${c.border}; font-size:0.7rem;">${ev.type}</span>
                    <span style="font-size:0.7rem; color:rgba(255,255,255,0.45);">${dateLabel}</span>
                </div>
                <button onclick="showEditEventModal('${ev.id}')" style="background:none; border:none; color:rgba(255,255,255,0.4); cursor:pointer; padding:4px 8px;"><i class="fas fa-edit"></i></button>
            </div>
            <div style="font-size:0.95rem; font-weight:500; color:rgba(255,255,255,0.92); margin-bottom:8px;">${ev.title || '(未命名)'}</div>
            ${membersHTML ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px;">${membersHTML}</div>` : ''}
            ${ev.notes ? `<div style="font-size:0.78rem; color:rgba(255,255,255,0.6); padding-top:6px; border-top:1px dashed rgba(255,255,255,0.06);">${ev.notes.replace(/\n/g, '<br>')}</div>` : ''}
            <div style="font-size:0.65rem; color:rgba(255,255,255,0.3); margin-top:8px;">建立 ${ev.createdBy || '?'} · 最後修改 ${ev.updatedBy || '?'} ${ev.updatedAt ? new Date(ev.updatedAt).toLocaleString('zh-TW', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}) : ''}</div>
        </div>`;
    }).join('');
};


// ===== 開啟新增 modal =====
window.showAddEventModal = function (presetDate) {
    if (!window.getCurrentUser()) {
        window.showWhoModal();
        return;
    }

    window.calendarState.editingEventId = null;
    document.getElementById('event-modal-title').innerHTML = '<i class="fas fa-calendar-plus"></i> 新增行程';
    document.getElementById('btn-delete-event').style.display = 'none';
    document.getElementById('event-id').value = '';

    const dateVal = presetDate || window.calendarState.selectedDate || new Date().toISOString().slice(0, 10);
    document.getElementById('event-start-date').value = dateVal;
    document.getElementById('event-end-date').value = dateVal;
    document.getElementById('event-type').value = '出差';
    document.getElementById('event-title').value = '';
    document.getElementById('event-notes').value = '';

    renderMembersPicker([]);
    document.getElementById('event-modal').style.display = 'flex';
};


// ===== 開啟編輯 modal =====
window.showEditEventModal = function (eventId) {
    if (!window.getCurrentUser()) {
        window.showWhoModal();
        return;
    }

    const ev = window.calendarState.events.find(e => e.id === eventId);
    if (!ev) return;

    window.calendarState.editingEventId = eventId;
    document.getElementById('event-modal-title').innerHTML = '<i class="fas fa-edit"></i> 編輯行程';
    document.getElementById('btn-delete-event').style.display = 'inline-block';
    document.getElementById('event-id').value = ev.id;
    document.getElementById('event-start-date').value = ev.startDate || '';
    document.getElementById('event-end-date').value = ev.endDate || ev.startDate || '';
    document.getElementById('event-type').value = ev.type || '出差';
    document.getElementById('event-title').value = ev.title || '';
    document.getElementById('event-notes').value = ev.notes || '';

    renderMembersPicker(ev.members || []);
    document.getElementById('event-modal').style.display = 'flex';
};


// ===== 渲染人員多選 =====
window.renderMembersPicker = function (selectedMembers) {
    const container = document.getElementById('event-members');
    if (!container) return;

    if (!window.calendarState.members || window.calendarState.members.length === 0) {
        container.innerHTML = '<span style="color:rgba(255,255,255,0.4); font-size:0.85rem;">無人員資料，請在 Sheets 的「人員清單」分頁新增</span>';
        return;
    }

    const selected = new Set(selectedMembers);
    container.innerHTML = window.calendarState.members.map(name => {
        const isSel = selected.has(name);
        const style = isSel
            ? 'background:rgba(198,166,130,0.3); border:1px solid rgba(198,166,130,0.55); color:#f2dcb6;'
            : 'background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.7);';
        return `<button type="button" data-member="${name}" data-selected="${isSel}" onclick="toggleMemberPick(this)" style="${style} padding:4px 12px; border-radius:99px; cursor:pointer; font-size:0.8rem;">${name}</button>`;
    }).join('');
};

window.toggleMemberPick = function (btn) {
    const sel = btn.dataset.selected === 'true';
    if (sel) {
        btn.dataset.selected = 'false';
        btn.style.cssText = 'background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.7); padding:4px 12px; border-radius:99px; cursor:pointer; font-size:0.8rem;';
    } else {
        btn.dataset.selected = 'true';
        btn.style.cssText = 'background:rgba(198,166,130,0.3); border:1px solid rgba(198,166,130,0.55); color:#f2dcb6; padding:4px 12px; border-radius:99px; cursor:pointer; font-size:0.8rem;';
    }
};


// ===== 關閉 modal =====
window.closeEventModal = function () {
    document.getElementById('event-modal').style.display = 'none';
    window.calendarState.editingEventId = null;
};


// ===== 儲存（新增 or 更新） =====
window.saveEvent = async function () {
    const user = window.getCurrentUser();
    if (!user) {
        alert('請先選擇你的名字！');
        window.showWhoModal();
        return;
    }

    const startDate = document.getElementById('event-start-date').value;
    const endDate = document.getElementById('event-end-date').value || startDate;
    const type = document.getElementById('event-type').value;
    const title = document.getElementById('event-title').value.trim();
    const notes = document.getElementById('event-notes').value.trim();

    if (!startDate) {
        alert('請選擇開始日期');
        return;
    }
    if (endDate < startDate) {
        alert('結束日期不能早於開始日期');
        return;
    }
    if (!title) {
        alert('請填寫行程標題');
        return;
    }

    const memberBtns = document.querySelectorAll('#event-members button[data-selected="true"]');
    const members = Array.from(memberBtns).map(b => b.dataset.member);

    // [必填驗證] 至少要選一個人員
    if (members.length === 0) {
        alert('請至少選擇一位參與人員！');
        // highlight 人員區域，讓使用者注意
        const membersBox = document.getElementById('event-members');
        if (membersBox) {
            membersBox.style.transition = 'box-shadow 0.3s, border-color 0.3s';
            membersBox.style.boxShadow = '0 0 0 2px rgba(212,160,160,0.5)';
            membersBox.style.borderColor = 'rgba(212,160,160,0.6)';
            membersBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                membersBox.style.boxShadow = '';
                membersBox.style.borderColor = '';
            }, 2000);
        }
        return;
    }

    const payload = {
        action: window.calendarState.editingEventId ? 'updateCalendarEvent' : 'addCalendarEvent',
        id: window.calendarState.editingEventId || undefined,
        startDate, endDate, type, title, notes,
        members,
        user: user
    };

    const saveBtn = document.querySelector('.btn-save-event');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '儲存中...';
    }

    try {
        const res = await fetch(ADMIN_API_URL, {
            method: 'POST',
            mode: 'cors',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.ok) {
            closeEventModal();
            await fetchCalendarEvents();
        } else {
            alert('儲存失敗：' + (data.error || '未知錯誤'));
        }
    } catch (e) {
        console.error('Save event error:', e);
        alert('儲存失敗（網路或伺服器錯誤）');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '儲存行程';
        }
    }
};


// ===== 刪除事件（從 modal 內按刪除）=====
window.deleteCurrentEvent = async function () {
    const id = window.calendarState.editingEventId;
    if (!id) return;
    if (!confirm('確定要刪除這筆行程？此操作無法復原。')) return;

    const user = window.getCurrentUser() || '未知';

    try {
        const res = await fetch(ADMIN_API_URL, {
            method: 'POST',
            mode: 'cors',
            body: JSON.stringify({ action: 'deleteCalendarEvent', id, user })
        });
        const data = await res.json();
        if (data.ok) {
            closeEventModal();
            await fetchCalendarEvents();
        } else {
            alert('刪除失敗：' + (data.error || '未知錯誤'));
        }
    } catch (e) {
        console.error('Delete event error:', e);
        alert('刪除失敗（網路或伺服器錯誤）');
    }
};


// ===== 更新 Hub 行事曆預覽（首頁底部那條）=====
window.updateHubCalendarPreview = function () {
    const el = document.getElementById('hub-cal-preview');
    if (!el) return;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayEvents = getEventsForDate(todayStr);

    if (todayEvents.length === 0) {
        el.textContent = '今日無排程';
    } else if (todayEvents.length === 1) {
        const ev = todayEvents[0];
        el.textContent = `今日：${ev.type} · ${ev.title}`;
    } else {
        el.textContent = `今日 ${todayEvents.length} 筆排程`;
    }
};


// ===== 初始化（進入 Calendar 頁時呼叫）=====
window.initCalendarModule = async function () {
    // 顯示「你是誰？」對話框（如果未設定）
    if (!window.getCurrentUser()) {
        await window.fetchCalendarMembers();
        window.showWhoModal();
    } else if (!window.calendarState.members || window.calendarState.members.length === 0) {
        await window.fetchCalendarMembers();
    }

    // 載入事件並渲染
    await window.fetchCalendarEvents();

    // 預設選中今日
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    window.calendarState.selectedDate = todayStr;
    
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        // 手機週曆：currentDate 是今天，用來計算本週
        window.calendarState.currentDate = new Date(today);
    } else {
        // 桌面月曆：currentDate 是本月 1 號
        window.calendarState.currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    renderCalendar();
    renderEventList();
};


// ===== Hub 預覽用：背景自動載入事件（不開行事曆頁也載入）=====
window.preloadCalendarForHub = async function () {
    try {
        if (!window.calendarState.members || window.calendarState.members.length === 0) {
            await window.fetchCalendarMembers();
        }
        await window.fetchCalendarEvents();
    } catch (e) {
        console.warn('[Calendar] Hub preload failed:', e);
    }
};


// ============================================================
// 訂單板自動同步（給「掛著看」的人）— v2 新增
// 每 10 秒在背景重抓訂單；資料真的變了才重畫（沒變不重畫＝不閃）
// 只在「分頁在前景 + 正在看訂單板 + 沒在處理 + 沒開著視窗」時才動
// 防疊：上一次請求還沒回來，就跳過這次（避免請求疊在一起）
// 純新增、不依賴它做 correctness；要移除直接刪這整段即可
// ============================================================
(function setupOrderAutoSync() {
    const POLL_MS = 10000; // 10 秒。要更即時可改 8000；別低於 5000，省 GAS 額度
    let inFlight = false;  // 防疊請求：上一次還沒回來就跳過這次

    // 用 (狀態/金額/筆數) 當指紋，判斷畫面該不該重畫
    function signature(list) {
        if (!Array.isArray(list)) return '';
        return list.length + '|' + list.map(o =>
            String(o.timestamp) + ':' + (o.status || '') + ':' +
            (o.total || 0) + ':' + (o.shippingFee || 0)
        ).join(',');
    }

    function safeToRefresh() {
        if (document.visibilityState !== 'visible') return false;       // 分頁切到背景 → 不抓
        const dash = document.getElementById('dashboard');
        if (!dash || dash.classList.contains('hidden')) return false;  // 不在訂單板 → 不抓
        if (window.currentPrimaryView === 'inventory') return false;   // 在庫存子頁 → 看板沒顯示，不用抓
        if (window.isProcessing) return false;                         // 正在扣帳/送出 → 不打斷
        const modal = document.getElementById('modal');
        if (modal && modal.style.display === 'flex') return false;     // 報價/核對/明細視窗開著 → 不在他臉上重畫
        return true;
    }

    async function syncTick() {
        if (inFlight) return;            // 上一次請求還沒回 → 跳過，不疊請求
        if (!safeToRefresh()) return;
        inFlight = true;
        try {
            const res = await fetch(ADMIN_API_URL + '?action=getOrders&t=' + Date.now());
            const json = await res.json();
            if (!json || !json.orders) return;

            // 與 fetchOrders 同一套「進度較前者勝」合併規則
            const STATUS_ORDER = ['unquoted', 'quoted', 'paid', 'cutting', 'inspection', 'picking', 'packing', 'shipping', 'dispatched', 'completed'];
            const _rank = s => STATUS_ORDER.indexOf(s);
            const savedStatuses = JSON.parse(localStorage.getItem('order_statuses') || '{}');
            const merged = json.orders.map(order => {
                const key = String(order.timestamp);
                const backendStatus = order.status || '';
                const localStatus = savedStatuses[key];
                if (localStatus && _rank(localStatus) > _rank(backendStatus)) order.status = localStatus;
                else order.status = backendStatus || 'unquoted';
                return order;
            });

            // fetch 期間使用者可能開了視窗，再確認一次
            if (!safeToRefresh()) return;

            // 資料沒變 → 什麼都不做（不重畫、不閃、不跳捲動）
            if (signature(merged) === signature(ordersData)) return;

            // 有變 → 套用並走原本渲染路徑（徽章等照常顯示）
            ordersData = merged;
            try {
                localStorage.setItem('orders_cache', JSON.stringify(merged));
                localStorage.setItem('orders_cache_time', Date.now());
            } catch (e) { }
            if (window.assignProjectIds) window.assignProjectIds();
            if (typeof applyFilter === 'function') applyFilter();
            const lu = document.getElementById('last-update');
            if (lu) lu.innerText = '最後更新: ' + new Date().toLocaleTimeString();
        } catch (e) {
            console.warn('[autoSync] 背景同步失敗:', e && e.message); // 失敗就靜默略過，不打擾
        } finally {
            inFlight = false; // 不管成功失敗都釋放，下一輪才能再抓
        }
    }

    setInterval(syncTick, POLL_MS);

    // 分頁從背景切回前景 → 立刻補抓一次，不用等下一輪
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncTick();
    });
})();
