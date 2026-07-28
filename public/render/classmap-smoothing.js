export function smoothClassmapTexture(texture, {
  canvasFactory = () => document.createElement('canvas'),
  warn = (...args) => console.warn(...args),
} = {}) {
  try {
    if (!texture?.image) throw new Error('Classmap image is missing');
    const { width, height } = texture.image;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new Error('Classmap image dimensions are missing or invalid');
    }

    const canvas = canvasFactory();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Classmap smoothing canvas has no 2D context');
    context.filter = 'blur(4px)';
    context.drawImage(texture.image, 0, 0);

    // Texture state changes only after every fallible processing step succeeds.
    texture.image = canvas;
    texture.needsUpdate = true;
    return { status: 'smoothed', image: canvas };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[render] classmap smoothing failed: ${message}; raw classmap fallback`, error);
    return { status: 'raw-fallback', error };
  }
}
