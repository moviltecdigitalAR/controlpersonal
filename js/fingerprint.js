// ============================================================
// FINGERPRINT DEL DISPOSITIVO
// Genera un ID estable para el celular sin librerías externas.
// El fingerprint se cachea en localStorage para garantizar que
// siempre sea el mismo valor en el mismo dispositivo/navegador.
// ============================================================

const Fingerprint = (() => {

  const CACHE_KEY = 'ca_device_fp_v1';

  function canvasHash() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width  = 220;
      canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle    = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.font      = '11pt Arial';
      ctx.fillText('ControlAcceso', 2, 15);
      ctx.fillStyle = 'rgba(102, 200, 0, 0.7)';
      ctx.font      = '18pt Georgia';
      ctx.fillText('Cx', 4, 45);
      return canvas.toDataURL().slice(-80);
    } catch (_) {
      return 'no-canvas';
    }
  }

  async function audioHash() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return 'no-audio';
      const ctx = new AC({ sampleRate: 44100 });
      if (ctx.state === 'suspended') {
        await ctx.close();
        return 'audio-suspended';
      }
      const osc     = ctx.createOscillator();
      const analyser = ctx.createAnalyser();
      const gain    = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
      await new Promise(r => setTimeout(r, 50));
      const buf = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(buf);
      osc.stop();
      ctx.close();
      return buf.slice(0, 10).join(',');
    } catch (_) {
      return 'no-audio';
    }
  }

  function fnv1a(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h  = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  async function _generarNuevo() {
    const audio = await audioHash();
    const parts = [
      navigator.userAgent,
      navigator.language,
      (navigator.languages || []).join(','),
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 0,
      navigator.maxTouchPoints || 0,
      navigator.platform || '',
      canvasHash(),
      audio
    ];
    const raw = parts.join('||');
    return 'fp_' + fnv1a(raw) + '_' + fnv1a(raw.split('').reverse().join(''));
  }

  async function generate() {
    // Reutilizar el fingerprint guardado para garantizar estabilidad entre sesiones.
    // Si no existe (primer uso) o fue borrado, lo generamos y guardamos.
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached && cached.startsWith('fp_')) return cached;
    } catch (_) { /* localStorage bloqueado en algunos navegadores privados */ }

    const fp = await _generarNuevo();

    try { localStorage.setItem(CACHE_KEY, fp); } catch (_) {}

    return fp;
  }

  // Permite borrar el caché (útil si el admin resetea el dispositivo)
  function clear() {
    try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
  }

  return { generate, clear };
})();
