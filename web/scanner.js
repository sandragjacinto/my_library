/**
 * Lecture du code-barres d'un livre (EAN-13 commençant par 978 ou 979 = ISBN-13) avec la caméra arrière.
 *
 * - Android / Chrome : détecteur intégré au navigateur (BarcodeDetector), rapide et sans téléchargement.
 * - iPhone / Safari et autres : bibliothèque ZXing, chargée seulement la première fois qu'on scanne.
 *
 * startScan(video, onCode) démarre la caméra et appelle onCode(isbn) une seule fois.
 * Elle renvoie une fonction stop() (sans effet si la lecture est déjà terminée).
 */
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm';
const isIsbn = s => /^97[89]\d{10}$/.test(s);

export async function startScan(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('ce navigateur ne donne pas accès à la caméra');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();

  let done = false, zxingControls = null;
  const stop = () => {
    if (done) return;
    done = true;
    if (zxingControls) zxingControls.stop();
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
  const found = code => { if (done) return; stop(); onCode(code); };

  if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('ean_13')) {
    const detector = new BarcodeDetector({ formats: ['ean_13'] });
    const tick = async () => {
      if (done) return;
      try {
        const code = (await detector.detect(video)).map(r => r.rawValue).find(isIsbn);
        if (code) return found(code);
      } catch (e) { /* image pas encore prête : on réessaie */ }
      setTimeout(tick, 150);
    };
    tick();
    return stop;
  }

  try {
    const { BrowserMultiFormatReader } = await import(ZXING_URL);
    if (done) return stop;
    const reader = new BrowserMultiFormatReader();
    zxingControls = await reader.decodeFromVideoElement(video, (result) => {
      const code = result && result.getText();
      if (code && isIsbn(code)) found(code);
    });
    if (done) zxingControls.stop();
  } catch (e) {
    stop();
    throw new Error('lecteur de code-barres introuvable, vérifie ta connexion');
  }
  return stop;
}
