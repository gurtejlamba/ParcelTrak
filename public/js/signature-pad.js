// Minimal dependency-free signature capture for the Proof of Delivery form.
(function () {
  const canvas = document.getElementById('signature-pad');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const hiddenInput = document.getElementById('signatureData');
  const clearBtn = document.getElementById('clearSignature');
  const form = document.getElementById('podForm');

  let drawing = false;
  let hasDrawn = false;

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#0f2a4a';
  }
  resizeCanvas();

  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    hasDrawn = true;
    const p = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  clearBtn.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  });

  form.addEventListener('submit', (e) => {
    if (!hasDrawn) {
      e.preventDefault();
      alert('Please capture the receiver\'s signature before submitting.');
      return;
    }
    hiddenInput.value = canvas.toDataURL('image/png');
  });
})();
