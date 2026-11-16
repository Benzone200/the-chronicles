const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

/*
 * Saves an uploaded image and returns its public URL.
 *  - With BLOB_READ_WRITE_TOKEN (Vercel Blob): stored in the cloud, returns an https URL.
 *  - Otherwise (local development): stored in /uploads and served by Express.
 */
async function saveImage(buffer, ext, contentType) {
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const blob = await put(`uploads/${name}`, buffer, { access: 'public', contentType, addRandomSuffix: false });
    return blob.url;
  }
  if (process.env.VERCEL) throw new Error('Image storage is not set up yet (missing BLOB_READ_WRITE_TOKEN).');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

function looksLikeImage(buf) {
  const hex = buf.subarray(0, 4).toString('hex');
  return (
    hex.startsWith('ffd8ff') ||
    hex === '89504e47' ||
    buf.toString('ascii', 0, 4) === 'GIF8' ||
    (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
  );
}

module.exports = { saveImage, looksLikeImage, UPLOAD_DIR };
