export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateImage(file) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return 'Choose a JPG, PNG, or WebP image.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'Your photo must be 5 MB or smaller.';
  }
  return '';
}

export function cropImage(imageUrl, pixels, mimeType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixels.width;
      canvas.height = pixels.height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Your browser could not prepare this image.'));
        return;
      }
      context.drawImage(
        image,
        pixels.x,
        pixels.y,
        pixels.width,
        pixels.height,
        0,
        0,
        pixels.width,
        pixels.height,
      );
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Your browser could not prepare this image.'));
        },
        mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
        0.9,
      );
    };
    image.onerror = () => reject(new Error('This image could not be opened.'));
    image.src = imageUrl;
  });
}
