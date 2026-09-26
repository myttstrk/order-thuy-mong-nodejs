const appState = {
  tickets: [],
  merch: [],
  cart: [],
  paymentPollTimer: null
};

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0
}).format(value);

const toast = document.getElementById('toast');

function showToast(message) {
  toast.innerHTML = `
    <span class="toast-breadcrumb">Thủy Mộng</span>
    <span class="toast-separator">/</span>
    <span class="toast-breadcrumb">Thông báo</span>
    <span class="toast-separator">/</span>
    <span class="toast-text">${message}</span>
  `;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function showPaymentSuccessModal(order = null) {
  const modal = document.getElementById('payment-success-modal');
  const message = document.getElementById('payment-success-message');
  const meta = document.getElementById('payment-success-meta');
  if (!modal || !message || !meta) return;

  const orderCode = order?.orderCode || 'ĐƠN HÀNG';
  message.textContent = 'Đơn hàng của bạn đã được xác nhận. QR check-in sẽ được gửi qua email hoặc hiển thị ngay trên màn hình.';
  meta.innerHTML = `<strong>Mã đơn hàng:</strong> ${orderCode}`;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hidePaymentSuccessModal() {
  const modal = document.getElementById('payment-success-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function getItemMax(item) {
  if (!item) return 999;
  const value = Number(item.quantity ?? item.baseQuantity ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function addItemToCart(item, quantity = 1) {
  const normalizedQty = Number(quantity);
  const max = getItemMax(item);

  if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
    showToast('Số lượng phải lớn hơn 0.');
    return;
  }

  const existing = appState.cart.find((entry) => entry.id === item.id && entry.type === item.type);

  if (max <= 0) {
    showToast('Sản phẩm đã hết hàng.');
    return;
  }

  if (existing) {
    const nextQty = existing.quantity + normalizedQty;
    if (nextQty > max) {
      showToast(`Chỉ còn ${max} sản phẩm trong kho!`);
      existing.quantity = max;
    } else {
      existing.quantity = nextQty;
    }
  } else {
    const safeQty = Math.min(normalizedQty, max);
    if (normalizedQty > max) {
      showToast(`Chỉ còn ${max} sản phẩm trong kho!`);
    }
    appState.cart.push({ ...item, quantity: safeQty });
  }

  renderCart();
  updateCartButton();
  showToast(`${item.name} đã được thêm vào giỏ hàng.`);
}

function updateCartButton() {
  const navBookButton = document.getElementById('nav-book-button');
  if (!navBookButton) return;
  const itemCount = appState.cart.reduce((sum, item) => sum + item.quantity, 0);
  navBookButton.textContent = `Giỏ hàng: ${itemCount}`;
}

function removeCartItem(id, type) {
  appState.cart = appState.cart.filter((item) => !(item.id === id && item.type === type));
  renderCart();
  updateCartButton();
}

function changeCartQuantity(id, type, delta) {
  const item = appState.cart.find((entry) => entry.id === id && entry.type === type);
  if (!item) return;

  const source = type === 'ticket' ? appState.tickets : appState.merch;
  const originalItem = source.find(entry => entry.id === id);
  const max = getItemMax(originalItem);

  if (delta > 0) {
    if (item.quantity + delta > max) {
      showToast(`Chỉ còn ${max} sản phẩm trong kho!`);
      item.quantity = max;
    } else {
      item.quantity += delta;
    }
  } else {
    item.quantity = Math.max(1, item.quantity + delta);
  }

  renderCart();
  updateCartButton();
}

function renderPaidOrderStatus(order) {
  const paymentInfoEl = document.getElementById('payment-account-info');
  if (!paymentInfoEl) return;

  if (order.status === 'Đã thanh toán') {
    const qrMarkup = order.qrCodeUrl
      ? `<img class="payment-qr checkin-qr" src="${order.qrCodeUrl}" alt="QR check-in đơn ${order.orderCode}" />`
      : '';

    paymentInfoEl.innerHTML = `
      <div class="payment-success-box">
        <h4>Đã thanh toán thành công</h4>
        <p class="payment-success">Hệ thống đã nhận được khoản chuyển khoản của bạn.</p>
        ${qrMarkup}
        <p><strong>Mã đơn hàng:</strong> ${order.orderCode}</p>
        <p><strong>Nơi nhận hàng:</strong> ${order.deliveryLocation || 'Nhận tại sự kiện'}</p>
        <p><strong>Trạng thái vé:</strong> ${order.ticketStatus || 'Chưa sử dụng'}</p>
        <p>QR check-in đã hiển thị trực tiếp trên màn hình. Bạn có thể chụp màn hình hoặc tải hình ảnh về để dùng khi vào sự kiện.</p>
        ${order.qrCodeUrl ? `<a href="${order.qrCodeUrl}" download="QR-Checkin-${order.orderCode}.png" class="btn btn-primary full-width" style="text-align: center; margin-top: 12px;">Tải mã QR</a>` : ''}
      </div>
    `;
  }
}

function startPaymentStatusPolling(orderCode, email) {
  clearInterval(appState.paymentPollTimer);
  const query = email ? `?email=${encodeURIComponent(email)}` : '';

  const checkStatus = async () => {
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderCode)}/status${query}`);
      if (!response.ok) return;
      const result = await response.json();
      renderPaidOrderStatus(result.order);
      if (result.order.status === 'Đã thanh toán') {
        clearInterval(appState.paymentPollTimer);
        showToast('Đã nhận thanh toán và cập nhật trạng thái đơn hàng.');
        appState.cart = [];
        renderCart();
        updateCartButton();
        showPaymentSuccessModal(result.order);
      }
    } catch (error) {
      console.warn('Unable to refresh payment status:', error);
    }
  };

  checkStatus();
  appState.paymentPollTimer = setInterval(checkStatus, 5000);
}

function getMerchImageHtml(item) {
  if (item.image) {
    return '<img src="' + item.image + '" alt="' + item.name + '" class="ticket-card-img" />';
  }
  return '<div class="merch-art" aria-hidden="true">' + (item.id === 'combo-merch' ? 'COMBO' : 'KHĂN') + '</div>';
}

function getTicketImageSrc(ticket) {
  return ticket.image || (ticket.id + '.jpg');
}

function renderTickets() {
  const container = document.getElementById('ticket-grid');
  container.innerHTML = appState.tickets
    .map((ticket) => {
      const max = getItemMax(ticket);
      const isSoldOut = max <= 0;
      return `
      <article class="ticket-card ${isSoldOut ? 'sold-out' : ''}">
        <img src="${getTicketImageSrc(ticket)}" alt="${ticket.name}" class="ticket-card-img" />
        <div class="ticket-top">
          <h3>${ticket.name}</h3>
          <span class="ticket-price">${formatCurrency(ticket.price)}</span>
        </div>
        <p>${ticket.description || ticket.benefit || ''}</p>
        <div class="choose-row">
          ${isSoldOut 
            ? '<span class="sold-out-badge" style="color: #e74c3c; font-weight: bold; padding: 8px 16px; background: rgba(231, 76, 60, 0.1); border-radius: 4px; width: 100%; text-align: center;">Đã hết vé</span>'
            : `<div class="qty-control">
                <button type="button" class="qty-btn" data-action="decrease" data-id="${ticket.id}" data-type="ticket">−</button>
                <input type="number" class="qty-input" data-qty="${ticket.id}" data-type="ticket" value="1" min="1" max="${max}" />
                <button type="button" class="qty-btn" data-action="increase" data-id="${ticket.id}" data-type="ticket">+</button>
              </div>
              <button class="add-to-cart" data-add="${ticket.id}" data-type="ticket">Thêm</button>`
          }
        </div>
      </article>
    `;
    })
    .join('');

  bindQuantityButtons(container);
  bindAddButtons(container);
}

function getMerchDesc(item) {
  if (item.description) return item.description;
  if (item.benefit) return item.benefit;
  return item.id === 'combo-merch' ? 'Combo merch gồm quạt, móc khóa, sticker.' : 'Khăn độc quyền sự kiện, có thể áp dụng ưu đãi giảm giá theo hạng vé mua.';
}

function renderMerch() {
  const container = document.getElementById('merch-grid');
  container.innerHTML = appState.merch
    .map((item) => {
      const max = getItemMax(item);
      const isSoldOut = max <= 0;
      return `
      <article class="merch-card ${isSoldOut ? 'sold-out' : ''}">
        ${getMerchImageHtml(item)}
        <div class="ticket-top">
          <h3>${item.name}</h3>
          <span class="ticket-price">${formatCurrency(item.price)}</span>
        </div>
        <p>${getMerchDesc(item)}</p>
        <div class="choose-row">
          ${isSoldOut
            ? '<span class="sold-out-badge" style="color: #e74c3c; font-weight: bold; padding: 8px 16px; background: rgba(231, 76, 60, 0.1); border-radius: 4px; width: 100%; text-align: center;">Đã hết hàng</span>'
            : `<div class="qty-control">
                <button type="button" class="qty-btn" data-action="decrease" data-id="${item.id}" data-type="merch">−</button>
                <input type="number" class="qty-input" data-qty="${item.id}" data-type="merch" value="1" min="1" max="${max}" />
                <button type="button" class="qty-btn" data-action="increase" data-id="${item.id}" data-type="merch">+</button>
              </div>
              <button class="add-to-cart" data-add="${item.id}" data-type="merch">Thêm</button>`}
        </div>
      </article>
    `;
    })
    .join('');

  bindQuantityButtons(container);
  bindAddButtons(container);
}

function clampQuantity(value, max) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 999;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.max(1, parsed), safeMax);
}

function updateQtyValue(id, type, delta) {
  const qtyEl = document.querySelector(`[data-qty="${id}"]`);
  if (!qtyEl) return;

  const current = Number(qtyEl.value) || 1;
  const max = Number(qtyEl.getAttribute('max')) || 999;
  const next = clampQuantity(current + delta, max);
  qtyEl.value = next;

  const addButton = document.querySelector(`[data-add="${id}"][data-type="${type}"]`);
  if (addButton) {
    addButton.dataset.qty = next;
  }
}

function bindQuantityButtons(container) {
  container.querySelectorAll('.qty-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const { action, id, type } = button.dataset;
      const qtyEl = document.querySelector(`input[data-qty="${id}"]`);
      if (!qtyEl) return;

      const current = Number(qtyEl.value) || 1;
      const max = Number(qtyEl.getAttribute('max')) || 999;

      if (action === 'increase' && current >= max) {
        qtyEl.value = String(max);
        showToast(`Chỉ còn ${max} sản phẩm trong kho!`);
        return;
      }

      if (action === 'decrease' && current <= 1) {
        qtyEl.value = '1';
        return;
      }

      const next = action === 'increase' ? clampQuantity(current + 1, max) : clampQuantity(current - 1, max);
      qtyEl.value = next;
    });
  });

  container.querySelectorAll('input.qty-input').forEach((input) => {
    input.addEventListener('input', () => {
      const max = Number(input.getAttribute('max')) || 999;
      const val = clampQuantity(input.value, max);
      input.value = String(val);
      if (Number(input.value) >= max && Number(input.value) > 1) {
        showToast(`Chỉ còn ${max} sản phẩm trong kho!`);
      }
    });

    input.addEventListener('change', () => {
      const max = Number(input.getAttribute('max')) || 999;
      const val = clampQuantity(input.value, max);
      input.value = String(val);
    });
  });
}

function bindAddButtons(container) {
  container.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.add;
      const type = button.dataset.type;
      const inputEl = document.querySelector(`input[data-qty="${id}"]`);
      const max = Number(inputEl?.getAttribute('max')) || 999;
      const quantity = clampQuantity(inputEl?.value || 1, max);

      if (inputEl) {
        inputEl.value = String(quantity);
      }

      const source = type === 'ticket' ? appState.tickets : appState.merch;
      const item = source.find((entry) => entry.id === id);
      if (!item) return;

      addItemToCart({ ...item, type }, quantity);
    });
  });
}

function calculateCartDiscountSummary(items = []) {
  const normalizedItems = Array.isArray(items) ? items.map((item) => ({
    id: String(item.id || ''),
    price: Number(item.price) || 0,
    quantity: Number(item.quantity) || 0,
    type: String(item.type || 'ticket')
  })) : [];

  const ticketItems = normalizedItems.filter((item) => item.type === 'ticket');
  const merchItems = normalizedItems.filter((item) => item.type === 'merch');
  const ticketCount = ticketItems.reduce((sum, item) => sum + item.quantity, 0);
  const ticketTierIds = new Set(ticketItems.map((item) => item.id));
  const hasValueTicket = ticketTierIds.has('sao-may') || ticketTierIds.has('thanh-la') || ticketTierIds.has('y-mon');
  const hasTuLinh = ticketTierIds.has('tu-linh');
  const khanItem = merchItems.find((item) => item.id === 'khan');
  const comboItem = merchItems.find((item) => item.id === 'combo-merch');

  let subtotal = normalizedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discounts = [];

  if (ticketCount >= 4) {
    const ticketSubtotal = ticketItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountAmount = ticketSubtotal * 0.1;
    discounts.push({
      label: 'Giảm 10% cho ấn phẩm tham dự sự kiện (từ 4 vé trở lên)',
      amount: discountAmount
    });
    subtotal -= discountAmount;
  }

  if ((hasValueTicket || hasTuLinh) && khanItem) {
    const rate = hasTuLinh ? 0.15 : 0.05;
    const discountAmount = khanItem.price * khanItem.quantity * rate;
    discounts.push({
      label: hasTuLinh ? 'Giảm 15% khi mua khăn độc quyền cho Tứ Linh' : 'Giảm 5% khi mua khăn độc quyền',
      amount: discountAmount
    });
    subtotal -= discountAmount;
  }

  if (hasTuLinh && comboItem) {
    const discountAmount = comboItem.price * comboItem.quantity;
    discounts.push({
      label: 'Tặng 01 combo merch khi mua Tứ Linh',
      amount: discountAmount
    });
    subtotal -= discountAmount;
  }

  return {
    subtotal: Math.max(0, subtotal + (discounts.reduce((sum, item) => sum + item.amount, 0))),
    discountTotal: discounts.reduce((sum, item) => sum + item.amount, 0),
    total: Math.max(0, subtotal),
    discounts
  };
}

function renderCart() {
  const cartItemsEl = document.getElementById('cart-items');
  const totalEl = document.getElementById('total-price');

  if (!appState.cart.length) {
    cartItemsEl.innerHTML = '<div class="empty-state">Giỏ hàng hiện đang trống. Hãy chọn vé hoặc merch để bắt đầu.</div>';
    totalEl.textContent = '0 VNĐ';
    updateCartButton();
    return;
  }

  const summary = calculateCartDiscountSummary(appState.cart);

  cartItemsEl.innerHTML = appState.cart
    .map((item) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <strong>${item.name}</strong>
          <span>${item.quantity} x ${formatCurrency(item.price)}</span>
        </div>
        <div class="cart-item-actions">
          <button type="button" class="cart-qty-btn" data-cart-action="decrease" data-id="${item.id}" data-type="${item.type}">−</button>
          <button type="button" class="cart-qty-btn" data-cart-action="increase" data-id="${item.id}" data-type="${item.type}">+</button>
          <strong>${formatCurrency(item.price * item.quantity)}</strong>
          <button type="button" class="cart-remove" data-cart-action="remove" data-id="${item.id}" data-type="${item.type}">Xóa</button>
        </div>
      </div>
    `)
    .join('');

  const discountMarkup = summary.discounts.length
    ? `
      <div class="discount-summary" style="margin-top: 16px;">
        <div class="discount-row" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; font-size: 0.95em; color: rgba(246, 242, 234, 0.8);">
          <span style="flex: 1; word-break: break-word;">Giá gốc:</span>
          <strong style="white-space: nowrap; flex-shrink: 0;">${formatCurrency(summary.subtotal)}</strong>
        </div>
        ${summary.discounts.map((discount) => `
          <div class="discount-row discount-line" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; font-size: 0.95em; color: #c99a61;">
            <span style="flex: 1; word-break: break-word;">${discount.label}:</span>
            <strong style="white-space: nowrap; flex-shrink: 0;">- ${formatCurrency(discount.amount)}</strong>
          </div>
        `).join('')}
        <div class="discount-row total-line" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(241, 198, 107, 0.3); font-size: 1.1em; color: #f1c66b;">
          <span style="flex: 1; word-break: break-word;">Tổng thanh toán:</span>
          <strong style="white-space: nowrap; flex-shrink: 0;">${formatCurrency(summary.total)}</strong>
        </div>
      </div>
    `
    : '';

  cartItemsEl.insertAdjacentHTML('beforeend', discountMarkup);
  totalEl.textContent = formatCurrency(summary.total);
  totalEl.title = summary.discounts.map((discount) => `${discount.label}: -${formatCurrency(discount.amount)}`).join(' | ') || 'Không có ưu đãi';
  updateCartButton();
  document.querySelectorAll('[data-cart-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const { cartAction, id, type } = button.dataset;
      if (cartAction === 'remove') removeCartItem(id, type);
      if (cartAction === 'increase') changeCartQuantity(id, type, 1);
      if (cartAction === 'decrease') changeCartQuantity(id, type, -1);
    });
  });
}

async function loadData() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();

    appState.tickets = data.tickets;
    appState.merch = data.merch;

    const footerList = document.querySelectorAll('.site-footer li');
    if (data.contact && footerList.length >= 4) {
      footerList[0].textContent = data.contact.unit;
      footerList[1].textContent = data.contact.address;
      footerList[2].textContent = data.contact.phone;
      footerList[3].textContent = data.contact.email;
    }

    renderTickets();
    renderMerch();
    renderCart();
  } catch (error) {
    console.error('Failed to load data:', error);

    appState.tickets = [
      { id: 'pt', name: 'Vé Phổ Thông', price: 1000, benefit: 'Ghế khu vực tầng chính, tầm nhìn tiêu chuẩn, thưởng thức trọn vẹn suất diễn múa rối nước.' },
      { id: 'tc', name: 'Vé Tiêu Chuẩn', price: 1000, benefit: 'Ghế vị trí trung tâm rõ hơn, tặng kèm 01 quạt giấy lưu niệm thiết kế độc quyền sự kiện.' },
      { id: 'cc', name: 'Vé Cao Cấp', price: 1000, benefit: 'Ghế cận sân khấu view đẹp, tặng kèm 01 túi vải canvas "Thủy Mộng" và móc khóa nghệ thuật.' },
      { id: 'vip', name: 'Vé VIP', price: 1000, benefit: 'Ghế hàng đầu sát mặt nước, đặc quyền check-in lối đi riêng, nhận trọn bộ quà tặng và thư cảm ơn độc quyền.' }
    ];

    appState.merch = [
      { id: 'shirt', name: 'Áo thun Thủy Mộng', price: 1000 },
      { id: 'bag', name: 'Túi vải canvas Thủy Mộng', price: 1000 },
      { id: 'keychain', name: 'Móc khóa nghệ thuật', price: 1000 },
      { id: 'fan', name: 'Quạt giấy lưu niệm', price: 1000 }
    ];

    renderTickets();
    renderMerch();
    renderCart();
  }
  generateCaptcha();
}

const scrollButtons = document.querySelectorAll('[data-scroll]');
scrollButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

async function generateCaptcha() {
  const canvas = document.getElementById('captcha-canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const inputToken = document.getElementById('captcha-token');
  const inputAnswer = document.getElementById('captcha-input');
  
  if (ctx && inputToken && inputAnswer) {
    try {
      const response = await fetch('/api/captcha');
      const data = await response.json();
      
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = data.image;
      
      inputToken.value = data.token;
      inputAnswer.value = '';
      
      if (!canvas.dataset.clickable) {
        canvas.addEventListener('click', generateCaptcha);
        canvas.dataset.clickable = 'true';
        canvas.style.cursor = 'pointer';
        canvas.title = 'Bấm để đổi mã mới';
      }
    } catch (e) {
      console.error('Lỗi tải mã bảo vệ', e);
    }
  }
}

const checkoutForm = document.getElementById('checkout-form');
const paymentProofInput = document.getElementById('payment-proof-input');

const IMGBB_API_KEY = '736021b9deddbe506285ee70140a11bf';

async function readPaymentProofAsDataUrl(file) {
  if (!file) return '';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const image = new Image();
        image.onload = async () => {
          const canvas = document.createElement('canvas');
          const maxWidth = 1200;
          const maxHeight = 1200;
          let { width, height } = image;

          if (width > maxWidth || height > maxHeight) {
            const scale = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);

          // Lấy blob (file nén) từ canvas thay vì base64 string
          canvas.toBlob(async (blob) => {
            if (!blob) {
              return reject(new Error('Lỗi nén ảnh.'));
            }
            try {
              const formData = new FormData();
              formData.append('image', blob, file.name || 'receipt.jpg');
              
              // Đẩy lên ImgBB
              const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                method: 'POST',
                body: formData
              });
              
              const data = await res.json();
              if (data && data.success) {
                resolve(data.data.url); // Trả về URL của ảnh
              } else {
                reject(new Error(data?.error?.message || 'Lỗi tải ảnh lên ImgBB.'));
              }
            } catch (err) {
              reject(new Error('Không thể kết nối đến máy chủ lưu trữ ảnh.'));
            }
          }, 'image/jpeg', 0.72);
        };
        image.onerror = () => reject(new Error('Không đọc được ảnh chuyển khoản.'));
        image.src = String(reader.result || '');
      } catch (error) {
        reject(new Error('Không đọc được ảnh chuyển khoản.'));
      }
    };
    reader.onerror = () => reject(new Error('Không đọc được ảnh chuyển khoản.'));
    reader.readAsDataURL(file);
  });
}

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!appState.cart.length) {
    showToast('Giỏ hàng đang trống. Vui lòng chọn ít nhất 1 mặt hàng.');
    return;
  }

  const formData = new FormData(checkoutForm);

  const customerName = String(formData.get('name') || '').trim();
  const customerPhone = String(formData.get('phone') || '').trim();
  const customerEmail = String(formData.get('email') || '').trim();

  if (customerName.length < 2) {
    showToast('Vui lòng nhập họ tên đầy đủ (tối thiểu 2 ký tự).');
    return;
  }

  const cleanPhone = customerPhone.replace(/\D/g, '');
  const vnPhoneRegex = /^0(3|5|7|8|9)[0-9]{8}$/;
  const isRepeatedPhone = /^(\d)\1+$/.test(cleanPhone) || cleanPhone === '0123456789' || cleanPhone === '123456789';
  if (!vnPhoneRegex.test(cleanPhone) || isRepeatedPhone) {
    showToast('Số điện thoại không hợp lệ. Vui lòng nhập SĐT Việt Nam (ví dụ: 0912345678).');
    return;
  }

  const emailLocalPart = (customerEmail.split('@')[0] || '').trim();
  if (emailLocalPart.length < 3) {
    showToast('Email không hợp lệ. Vui lòng kiểm tra lại email.');
    return;
  }

  let proofImage = '';

  try {
    if (paymentProofInput && paymentProofInput.files && paymentProofInput.files[0]) {
      proofImage = await readPaymentProofAsDataUrl(paymentProofInput.files[0]);
    }
  } catch (error) {
    showToast(error.message || 'Không thể đọc ảnh thanh toán.');
    return;
  }

  const payload = {
    customer: {
      name: formData.get('name'),
      phone: formData.get('phone'),
      email: formData.get('email') || '',
      website: formData.get('website') || ''
    },
    captcha: {
      token: document.getElementById('captcha-token').value,
      answer: String(formData.get('captcha')).trim().toUpperCase()
    },
    deliveryLocation: formData.get('deliveryLocation') || 'Nhận tại sự kiện',
    paymentMethod: 'BANK',
    proofImage,
    cart: {
      items: appState.cart.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        type: item.type
      }))
    }
  };

  const submitBtn = checkoutForm.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang tạo đơn...';
  }

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      generateCaptcha();
      throw new Error(result.message || 'Xử lý đặt vé thất bại');
    }

    const payment = result.payment;
    const paymentInfoEl = document.getElementById('payment-account-info');
    if (paymentInfoEl && payment) {
      paymentInfoEl.innerHTML = `
        <h4>Quét QR để thanh toán</h4>
        <img class="payment-qr" src="${payment.paymentQrUrl}" alt="QR thanh toán đơn ${result.order.orderCode}" />
        <p><strong>Số tiền:</strong> ${formatCurrency(result.order.total)}</p>
        <p><strong>Nội dung chuyển khoản:</strong> ${payment.transferContent}</p>
        <p><strong>Ngân hàng:</strong> ${payment.bankName} · <strong>STK:</strong> ${payment.accountNumber}</p>
        <p class="payment-note">Sau khi chuyển khoản thành công, hệ thống sẽ tự động xác nhận thanh toán và hiển thị QR check-in ngay trên màn hình cho bạn.</p>
      `;

      const btnConfirmPayment = document.getElementById('btn-confirm-payment');
      if (btnConfirmPayment) {
        btnConfirmPayment.addEventListener('click', async () => {
          try {
            btnConfirmPayment.disabled = true;
            btnConfirmPayment.textContent = 'Đang xác nhận...';
            const confirmRes = await fetch(`/api/orders/${result.order.orderCode}/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });

            const confirmJson = await confirmRes.json();
            if (!confirmRes.ok) throw new Error(confirmJson.message || 'Xác nhận thất bại');

            btnConfirmPayment.style.display = 'none';
            showToast('Đã gửi xác nhận thanh toán!');
            showPaymentSuccessModal(result.order);

            appState.cart = [];
            renderCart();
            updateCartButton();
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Thanh toán bằng QR';
            }
          } catch (err) {
            showToast(err.message || 'Xác nhận thất bại');
            btnConfirmPayment.disabled = false;
            btnConfirmPayment.textContent = 'Xác nhận đã thanh toán';
          }
        });
      }
    }
    startPaymentStatusPolling(result.order.orderCode, result.order.customer.email || '');
    showToast('Đơn hàng đã tạo. Vui lòng quét QR để thanh toán.');
    if (submitBtn) {
      submitBtn.textContent = 'Kéo xuống dưới để quét QR';
    }
    document.getElementById('checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Thanh toán bằng QR';
    }
    showToast(error.message || 'Có lỗi xảy ra khi đặt vé.');
  }
});

const navBookButton = document.getElementById('nav-book-button');
if (navBookButton) {
  navBookButton.addEventListener('click', () => {
    document.getElementById('tickets').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.querySelectorAll('[data-close-success-modal]').forEach((el) => {
  el.addEventListener('click', hidePaymentSuccessModal);
});

loadData();
