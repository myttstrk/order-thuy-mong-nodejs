const statusFilter = document.getElementById('statusFilter');
const searchInput = document.getElementById('searchInput');
const ordersTableBody = document.getElementById('ordersTableBody');
const totalRevenueEl = document.getElementById('totalRevenue');
const totalOrdersEl = document.getElementById('totalOrders');
const paidOrdersEl = document.getElementById('paidOrders');
const usedTicketsEl = document.getElementById('usedTickets');

const scanResultEl = document.getElementById('scanResult');
const startScannerBtn = document.getElementById('startScannerBtn');
const stopScannerBtn = document.getElementById('stopScannerBtn');
const manualCheckinForm = document.getElementById('manualCheckinForm');
const manualQrCodeInput = document.getElementById('manualQrCode');

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0
}).format(Number(value || 0));

function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatScanInfo(order = {}) {
  const customer = order.customer || {};
  const items = (Array.isArray(order.items) && order.items.length)
    ? order.items.map((item) => `${escapeHtml(item.name)} x${item.quantity}`).join(', ')
    : escapeHtml(order.itemsStr || '—');

  return `
    <div class="scan-info-wrap">
      <div><strong>Mã đơn:</strong> ${escapeHtml(order.orderCode) || '—'}</div>
      <div><strong>Khách:</strong> ${escapeHtml(customer.name) || '—'}</div>
      <div><strong>SĐT:</strong> ${escapeHtml(customer.phone) || '—'}</div>
      <div><strong>Email:</strong> ${escapeHtml(customer.email) || '—'}</div>
      <div><strong>Nơi nhận:</strong> ${escapeHtml(order.deliveryLocation) || 'Nhận tại sự kiện'}</div>
      <div><strong>Vé:</strong> ${items}</div>
      <div><strong>Trạng thái:</strong> ${escapeHtml(order.ticketStatus) || 'Chưa sử dụng'}</div>
    </div>
  `;
}

async function loadOrders() {
  try {
    const status = statusFilter.value;
    const search = searchInput.value.trim();
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    if (search) params.set('search', search);

    const response = await fetch(`/api/admin/orders?${params.toString()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Admin API ${response.status}`);
    const data = await response.json();

    const summary = data.summary || {};
    totalRevenueEl.textContent = formatCurrency(summary.totalRevenue || 0);
    totalOrdersEl.textContent = summary.totalOrders || 0;
    paidOrdersEl.textContent = summary.paidOrders || 0;
    usedTicketsEl.textContent = summary.usedTickets || 0;

    window.proofImagesMap = window.proofImagesMap || {};

    ordersTableBody.innerHTML = (data.orders || [])
    .map((order) => {
      const customerName = escapeHtml(order.customer?.name || 'Khách hàng');
      const phone = escapeHtml(order.customer?.phone || '—');
      const deliveryLocation = escapeHtml(order.deliveryLocation || 'Nhận tại sự kiện');
      const isNeu = order.deliveryLocation && order.deliveryLocation.toLowerCase().includes('neu');
      const deliveryBadgeClass = isNeu ? 'neu' : 'event';
      const itemsText = (order.items && order.items.length) 
        ? order.items.map((item) => `${escapeHtml(item.name)} x${item.quantity}`).join(', ')
        : escapeHtml(order.itemsStr || '');
      const statusClass = order.status === 'Đã thanh toán' ? 'paid' : 'pending';
      const ticketClass = order.ticketStatus === 'Đã sử dụng' ? 'used' : 'pending';
      const confirmButton = order.status !== 'Đã thanh toán'
        ? `<button type="button" class="btn btn-small confirm-payment" data-order-code="${order.orderCode}">Xác nhận</button>`
        : '';

      const rawProofUrl = typeof order.proofImage === 'string' ? order.proofImage.trim() : '';
      const hasProof = rawProofUrl.startsWith('data:image/') || /^https?:\/\//i.test(rawProofUrl);

      if (hasProof) {
        window.proofImagesMap[order.orderCode] = rawProofUrl;
      }

      const proofImageHtml = hasProof
        ? `<div class="proof-cell">
             <img src="${rawProofUrl}" class="proof-mini-thumb" data-view-proof="${order.orderCode}" alt="Thumb" title="Bấm để phóng to" />
             <button type="button" class="btn-view-proof" data-view-proof="${order.orderCode}">Xem ảnh</button>
           </div>`
        : '<span class="text-muted" style="color: var(--muted); font-size: 0.85rem;">—</span>';

      let emailStatusHtml = '';
      if (order.status === 'Đã thanh toán') {
        if (order.emailSent) {
          emailStatusHtml = '<div class="email-status success" title="Email QR check-in đã gửi">✉ Đã gửi mail</div>';
        } else if (order.emailError) {
          emailStatusHtml = `
            <div class="email-status fail" title="${order.emailError.replace(/"/g, '&quot;')}">⚠ Lỗi gửi mail</div>
          `;
        } else {
          emailStatusHtml = `
            <div class="email-status" style="color: var(--muted);">Chưa gửi mail</div>
          `;
        }
      }

      let customerStatusHtml = '';
      if (order.status !== 'Đã thanh toán') {
        if (order.customerConfirmed) {
          customerStatusHtml = '<div style="margin-top: 4px; font-size: 0.8rem; color: #2da76d; font-weight: 600;">Khách: Đã xác nhận</div>';
        } else {
          customerStatusHtml = '<div style="margin-top: 4px; font-size: 0.8rem; color: #f59e0b;">Khách: Chờ xác nhận</div>';
        }
      }

      return `
        <tr>
          <td><strong>${order.orderCode}</strong></td>
          <td>${customerName}</td>
          <td>${phone}</td>
          <td><span class="delivery-badge ${deliveryBadgeClass}">${deliveryLocation}</span></td>
          <td>${itemsText || '—'}</td>
          <td>${formatCurrency(order.total || 0)}</td>
          <td>${proofImageHtml}</td>
          <td>
            <span class="badge ${statusClass}">${order.status}</span>
            ${customerStatusHtml}
            ${emailStatusHtml}
          </td>
          <td>
            <span class="badge ${ticketClass}">${order.ticketStatus || 'Chưa sử dụng'}</span>
            ${confirmButton}
          </td>
          <td>
            <button type="button" class="btn-delete-order" data-delete-order="${order.orderCode}" style="background: transparent; border: 1px solid #fca5a5; color: #dc2626; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 600; cursor: pointer;" title="Xóa đơn hàng này">Xóa</button>
          </td>
        </tr>
      `;
    })
      .join('') || '<tr><td colspan="10">Không có dữ liệu phù hợp.</td></tr>';
  } catch (error) {
    console.error('Unable to refresh orders:', error);
  }
}

statusFilter.addEventListener('change', loadOrders);
searchInput.addEventListener('input', loadOrders);

let qrScanner = null;

async function startScanner() {
  scanResultEl.className = 'scan-result neutral';
  scanResultEl.textContent = 'Đang mở camera...';

  try {
    const videoElem = document.getElementById('qr-video');
    if (!qrScanner) {
      qrScanner = new QrScanner(
        videoElem,
        async (result) => {
          qrScanner.stop();
          await submitCheckin(result.data || result);
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
        }
      );
    }
    await qrScanner.start();
    scanResultEl.textContent = 'Camera đã mở. Hãy quét mã QR vé của khách.';
  } catch (error) {
    console.error(error);
    scanResultEl.className = 'scan-result error';
    scanResultEl.textContent = 'Không thể truy cập camera. Vui lòng cấp quyền truy cập camera.';
  }
}

async function stopScanner() {
  try {
    if (qrScanner) {
      qrScanner.stop();
      scanResultEl.className = 'scan-result neutral';
      scanResultEl.textContent = 'Camera đã tắt.';
    }
  } catch (err) {
    console.error(err);
  }
}

async function submitCheckin(qrCode) {
  try {
    const response = await fetch('/api/admin/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrCode })
    });
    const result = await response.json();

    if (response.ok) {
      scanResultEl.className = 'scan-result success';
      scanResultEl.innerHTML = `
        <div><strong>Check-in thành công</strong></div>
        ${formatScanInfo(result.order)}
      `;
      await loadOrders();
    } else {
      scanResultEl.className = 'scan-result error';
      const detailHtml = result.order ? formatScanInfo(result.order) : '';
      scanResultEl.innerHTML = `
        <div>${result.message || 'Quét thất bại.'}</div>
        ${detailHtml}
      `;
    }

    setTimeout(() => {
      scanResultEl.className = 'scan-result neutral';
      scanResultEl.innerHTML = 'Camera đang chờ quét QR tiếp theo...';
      if (qrScanner) {
        qrScanner.start();
      }
    }, 5000);
  } catch (error) {
    scanResultEl.className = 'scan-result error';
    scanResultEl.textContent = 'Lỗi khi gửi dữ liệu check-in.';
    setTimeout(() => {
      if (qrScanner) qrScanner.start();
    }, 3000);
  }
}

async function confirmPendingPayment(orderCode) {
  try {
    const response = await fetch('/api/admin/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderCode })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Xác nhận thanh toán thất bại.');
    }

    scanResultEl.className = 'scan-result success';
    scanResultEl.textContent = `Đã xác nhận thanh toán cho ${result.order.orderCode}.`;
    await loadOrders();
  } catch (error) {
    scanResultEl.className = 'scan-result error';
    scanResultEl.textContent = error.message || 'Lỗi xác nhận thanh toán.';
  }
}

ordersTableBody.addEventListener('click', async (event) => {
  const confirmBtn = event.target.closest('.confirm-payment');
  if (confirmBtn) {
    const orderCode = confirmBtn.dataset.orderCode;
    if (orderCode) {
      const pwd = prompt("Nhập mật khẩu xác nhận đơn:");
      if (pwd === "minhvu") {
        await confirmPendingPayment(orderCode);
      } else {
        alert("Mật khẩu xác nhận sai!");
      }
    }
    return;
  }

  const proofBtn = event.target.closest('[data-view-proof]');
  if (proofBtn) {
    const orderCode = proofBtn.dataset.viewProof;
    const proofUrl = window.proofImagesMap ? window.proofImagesMap[orderCode] : null;
    if (proofUrl) {
      const modal = document.getElementById('imageModal');
      const img = document.getElementById('modalImage');
      if (modal && img) {
        img.src = proofUrl;
        modal.style.display = 'flex';
      }
    }
    return;
  }

  const deleteBtn = event.target.closest('.btn-delete-order');
  if (deleteBtn) {
    const orderCode = deleteBtn.dataset.deleteOrder;
    if (!orderCode) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa đơn hàng ${orderCode}?`)) return;
    try {
      deleteBtn.disabled = true;
      deleteBtn.textContent = '...';
      const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderCode)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Không thể xóa đơn hàng');
      await loadOrders();
    } catch (err) {
      alert('Lỗi: ' + (err.message || 'Không thể xóa'));
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Xóa';
    }
    return;
  }


});

const refreshOrdersBtn = document.getElementById('refreshOrdersBtn');
if (refreshOrdersBtn) {
  refreshOrdersBtn.addEventListener('click', async () => {
    try {
      refreshOrdersBtn.disabled = true;
      refreshOrdersBtn.textContent = '⏳ Đang tải từ Sheet...';
      
      // Bước 1: Tải / đồng bộ đơn hàng từ Google Sheet
      try {
        const restoreRes = await fetch('/api/admin/restore-from-sheet', { method: 'POST' });
        const restoreData = await restoreRes.json();
        if (restoreRes.ok && restoreData.success) {
          // Hiển thị kết quả sync ngắn gọn
          if (scanResultEl) {
            scanResultEl.className = 'scan-result success';
            scanResultEl.textContent = restoreData.message || 'Đã tải đơn hàng từ Sheet.';
            setTimeout(() => {
              scanResultEl.className = 'scan-result neutral';
              scanResultEl.textContent = '';
            }, 5000);
          }
        } else {
          console.warn('Restore from sheet warning:', restoreData.message);
          if (scanResultEl) {
            scanResultEl.className = 'scan-result error';
            scanResultEl.textContent = restoreData.message || 'Không thể tải từ Sheet.';
            setTimeout(() => {
              scanResultEl.className = 'scan-result neutral';
              scanResultEl.textContent = '';
            }, 5000);
          }
        }
      } catch (sheetErr) {
        console.warn('Không thể đồng bộ từ Sheet:', sheetErr.message);
      }
      
      // Bước 2: Tải lại danh sách đơn hàng
      await loadOrders();
    } catch (err) {
      alert('Lỗi: ' + (err.message || 'Lỗi khi tải lại dữ liệu'));
    } finally {
      refreshOrdersBtn.disabled = false;
      refreshOrdersBtn.textContent = '🔄 Làm mới';
    }
  });
}

const exportCsvBtn = document.getElementById('exportCsvBtn');
if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', async () => {
    try {
      exportCsvBtn.disabled = true;
      exportCsvBtn.textContent = 'Đang xuất...';

      const response = await fetch('/api/admin/orders', { cache: 'no-store' });
      if (!response.ok) throw new Error('Không thể tải dữ liệu');
      const data = await response.json();
      const orders = data.orders || [];

      if (orders.length === 0) {
        alert('Không có đơn hàng nào để xuất.');
        return;
      }

      const headers = ['Mã đơn', 'Tên khách', 'SĐT', 'Email', 'Nơi nhận', 'Hạng/Vật phẩm', 'Tổng tiền', 'Trạng thái thanh toán', 'Trạng thái vé', 'Thời gian tạo'];
      const rows = orders.map(o => {
        const items = (o.items || []).map(i => `${i.name} x${i.quantity}`).join(' | ');
        const total = o.total || 0;
        const createdAt = o.createdAt ? new Date(o.createdAt).toLocaleString('vi-VN') : '—';
        return [
          o.orderCode || '',
          o.customer?.name || '',
          o.customer?.phone || '',
          o.customer?.email || '',
          o.deliveryLocation || 'Nhận tại sự kiện',
          items,
          total,
          o.status || '',
          o.ticketStatus || 'Chưa sử dụng',
          createdAt
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ThuMong_DonHang_${now}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Lỗi xuất CSV: ' + (err.message || 'Không thể xuất'));
    } finally {
      exportCsvBtn.disabled = false;
      exportCsvBtn.textContent = '📥 Xuất CSV';
    }
  });
}

const imageModal = document.getElementById('imageModal');
const closeImageModalBtn = document.getElementById('closeImageModal');
const imageModalBackdrop = document.getElementById('imageModalBackdrop');

function closeImageLightbox() {
  if (imageModal) imageModal.style.display = 'none';
}

if (closeImageModalBtn) closeImageModalBtn.addEventListener('click', closeImageLightbox);
if (imageModalBackdrop) imageModalBackdrop.addEventListener('click', closeImageLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageLightbox();
});



startScannerBtn.addEventListener('click', startScanner);
stopScannerBtn.addEventListener('click', stopScanner);

manualCheckinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const qrCode = manualQrCodeInput.value.trim();
  if (!qrCode) {
    scanResultEl.className = 'scan-result error';
    scanResultEl.textContent = 'Vui lòng nhập mã QR cần check-in.';
    return;
  }

  await submitCheckin(qrCode);
  manualQrCodeInput.value = '';
});

// Navigation logic
const navLinks = document.querySelectorAll('.admin-nav a');
const sections = {
  '#overview': document.getElementById('overview'),
  '#orders': document.getElementById('orders'),
  '#items': document.getElementById('items'),
  '#scanner': document.getElementById('scanner')
};

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    const targetId = link.getAttribute('href');
    if (!sections[targetId]) return;
    
    e.preventDefault();
    
    // Update active state
    navLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    
    // Show target section, hide others
    Object.keys(sections).forEach(id => {
      if (sections[id]) {
        sections[id].style.display = id === targetId ? (id === '#overview' ? 'grid' : 'block') : 'none';
      }
    });

    if (targetId === '#items') {
      loadItems();
    }
  });
});

// --- Item Management Logic ---
const itemsTableBody = document.getElementById('itemsTableBody');
const itemModal = document.getElementById('itemModal');
const itemModalBackdrop = document.getElementById('itemModalBackdrop');
const addItemBtn = document.getElementById('addItemBtn');
const closeItemModalBtn = document.getElementById('closeItemModalBtn');
const itemForm = document.getElementById('itemForm');
const itemImageInput = document.getElementById('itemImage');

let currentEditingItemId = null;

function closeItemModal() {
  itemModal.style.display = 'none';
  itemModalBackdrop.style.display = 'none';
  itemForm.reset();
  currentEditingItemId = null;
}

addItemBtn.addEventListener('click', () => {
  currentEditingItemId = null;
  itemForm.reset();
  itemModal.style.display = 'block';
  itemModalBackdrop.style.display = 'block';
});

const refreshItemsBtn = document.getElementById('refreshItemsBtn');
if (refreshItemsBtn) {
  refreshItemsBtn.addEventListener('click', async () => {
    try {
      refreshItemsBtn.disabled = true;
      refreshItemsBtn.textContent = 'Đang làm mới...';
      await loadItems();
    } catch (err) {
      alert('Lỗi: ' + (err.message || 'Lỗi khi tải lại dữ liệu'));
    } finally {
      refreshItemsBtn.disabled = false;
      refreshItemsBtn.textContent = '🔄 Làm mới';
    }
  });
}

closeItemModalBtn.addEventListener('click', closeItemModal);
itemModalBackdrop.addEventListener('click', closeItemModal);

async function loadItems() {
  try {
    const res = await fetch('/api/admin/items');
    if (!res.ok) throw new Error('Không thể tải mặt hàng');
    const items = await res.json();
    
    itemsTableBody.innerHTML = items.map(item => {
      const totalStock = item.baseQuantity !== undefined && item.baseQuantity !== null ? Number(item.baseQuantity) : 0;
      const remainingStock = item.quantity !== undefined && item.quantity !== null ? Math.max(0, Number(item.quantity)) : totalStock;
      const displayTitle = item.title || item.name || '—';

      return `
      <tr>
        <td>
          ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;" />` : '<div style="width: 50px; height: 50px; background: #eee; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #888;">No IMG</div>'}
        </td>
        <td><strong>${item.name}</strong><br/><small style="color: #666;">${displayTitle}</small><br/><small style="color: #666;">Kho: ${totalStock} · Còn: ${remainingStock}</small></td>
        <td><code>${item.id}</code></td>
        <td>${item.type === 'ticket' ? 'Vé (Ticket)' : 'Ấn phẩm (Merch)'}</td>
        <td>${formatCurrency(item.price)}</td>
        <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.benefit || ''}">
          ${item.benefit || '—'}
        </td>
        <td>
          <button class="btn btn-outline edit-item-btn" data-id="${item.id}" style="padding: 4px 8px; font-size: 12px; margin-right: 4px; color: #000; border-color: #000;">Sửa</button>
          <button class="btn btn-outline delete-item-btn" data-id="${item.id}" style="padding: 4px 8px; font-size: 12px; color: #dc2626; border-color: #fca5a5;">Xóa</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="7">Chưa có mặt hàng nào.</td></tr>';

    // Add edit event listeners
    document.querySelectorAll('.edit-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const item = items.find(i => i.id === id);
        if (item) {
          currentEditingItemId = item.id;
          document.getElementById('itemTitle').value = item.title || item.name || '';
          document.getElementById('itemName').value = item.name;
          document.getElementById('itemId').value = item.id;
          document.getElementById('itemType').value = item.type;
          document.getElementById('itemPrice').value = item.price;
          document.getElementById('itemBenefit').value = item.benefit || '';
          document.getElementById('itemQuantity').value = item.baseQuantity !== undefined && item.baseQuantity !== null ? item.baseQuantity : '';
          
          itemModal.style.display = 'block';
          itemModalBackdrop.style.display = 'block';
        }
      });
    });

    // Add delete event listeners
    document.querySelectorAll('.delete-item-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm(`Bạn có chắc muốn xóa mặt hàng "${id}"?`)) {
          try {
            const res = await fetch(`/api/admin/items/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Xóa thất bại');
            loadItems();
          } catch (e) {
            alert(e.message);
          }
        }
      });
    });

  } catch (err) {
    console.error(err);
    itemsTableBody.innerHTML = `<tr><td colspan="7">Lỗi tải mặt hàng: ${err.message}</td></tr>`;
  }
}

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const submitBtn = itemForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang lưu...';
  
  try {
    const newItem = {
      id: document.getElementById('itemId').value.trim(),
      name: document.getElementById('itemName').value.trim(),
      title: document.getElementById('itemTitle').value.trim() || document.getElementById('itemName').value.trim(),
      type: document.getElementById('itemType').value,
      price: Number(document.getElementById('itemPrice').value),
      benefit: document.getElementById('itemBenefit').value.trim()
    };

    const qtyStr = document.getElementById('itemQuantity').value.trim();
    if (qtyStr !== '') {
      newItem.baseQuantity = Number(qtyStr);
    }

    // Convert image to Base64 if uploaded
    if (itemImageInput.files && itemImageInput.files[0]) {
      const file = itemImageInput.files[0];
      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      newItem.image = await base64Promise;
    } else if (currentEditingItemId) {
      // Retain old image if editing and no new image
      const res = await fetch('/api/admin/items');
      const items = await res.json();
      const oldItem = items.find(i => i.id === currentEditingItemId);
      if (oldItem && oldItem.image) {
        newItem.image = oldItem.image;
      }
    }

    const res = await fetch('/api/admin/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newItem)
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Không thể lưu mặt hàng');
    }

    closeItemModal();
    loadItems();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Lưu mặt hàng';
  }
});

loadOrders();
// setInterval(loadOrders, 5000);

const cleanupOrdersBtn = document.getElementById('cleanupOrdersBtn');
if (cleanupOrdersBtn) {
  cleanupOrdersBtn.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ các đơn chưa thanh toán (chưa được xác nhận) không? Các đơn này sẽ bị XÓA VĨNH VIỄN.')) return;
    
    cleanupOrdersBtn.disabled = true;
    cleanupOrdersBtn.textContent = 'Đang xóa...';
    try {
      const res = await fetch('/api/admin/cleanup-orders', { method: 'POST' });
      if (!res.ok) throw new Error('Network response was not ok');
      const data = await res.json();
      alert(data.message);
      loadOrders();
    } catch (err) {
      alert('Lỗi khi xóa: ' + err.message);
    } finally {
      cleanupOrdersBtn.disabled = false;
      cleanupOrdersBtn.textContent = '🗑️ Xóa tất cả đơn chưa xác nhận';
    }
  });
}
