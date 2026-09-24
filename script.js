const filterButtons = document.querySelectorAll('.filter-btn');
const ticketCards = document.querySelectorAll('.ticket-card');
const toast = document.getElementById('toast');
const buyButtons = document.querySelectorAll('.buy-btn');

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.filter;

    filterButtons.forEach((btn) => btn.classList.toggle('active', btn === button));

    ticketCards.forEach((card) => {
      const matches = target === 'all' || card.dataset.category === target;
      card.classList.toggle('hidden', !matches);
    });
  });
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 1800);
}

buyButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const card = button.closest('.ticket-card');
    const title = card.querySelector('h3')?.textContent || 'Sự kiện';
    showToast(`${title} đã được thêm vào giỏ hàng.`);
  });
});
