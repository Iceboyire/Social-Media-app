import { useCallback, useEffect, useState } from 'react';
import Cropper from 'react-easy-crop';
import { ImagePlus, RotateCcw, X } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, cropImage, validateImage } from '../lib/image';

export function PhotoCropper({ onCropped, onToast, initialUrl }) {
  const [source, setSource] = useState('');
  const [preview, setPreview] = useState(initialUrl ?? '');
  const [file, setFile] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (source.startsWith('blob:')) URL.revokeObjectURL(source);
    if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
  }, [source, preview]);

  const onCropComplete = useCallback((_area, croppedAreaPixels) => {
    setPixels(croppedAreaPixels);
  }, []);

  async function chooseFile(event) {
    const nextFile = event.target.files?.[0];
    event.target.value = '';
    if (!nextFile) return;
    const validationMessage = validateImage(nextFile);
    if (validationMessage) {
      setError(validationMessage);
      onToast(validationMessage);
      return;
    }
    const nextSource = URL.createObjectURL(nextFile);
    setSource((current) => {
      if (current.startsWith('blob:')) URL.revokeObjectURL(current);
      return nextSource;
    });
    setFile(nextFile);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setError('');
  }

  async function saveCrop() {
    try {
      if (!source || !pixels || !file) return;
      const cropped = await cropImage(source, pixels, file.type);
      if (cropped.size > 5 * 1024 * 1024) {
        throw new Error('The cropped photo is still larger than 5 MB.');
      }
      const nextPreview = URL.createObjectURL(cropped);
      setPreview((current) => {
        if (current.startsWith('blob:')) URL.revokeObjectURL(current);
        return nextPreview;
      });
      onCropped(cropped, true);
      setSource('');
      setFile(null);
      onToast('Your photo is ready.', 'success');
    } catch (cropError) {
      const message = cropError.message || 'We could not crop that photo.';
      setError(message);
      onToast(message);
    }
  }

  function clearPhoto() {
    setSource((current) => {
      if (current.startsWith('blob:')) URL.revokeObjectURL(current);
      return '';
    });
    setPreview('');
    setFile(null);
    setError('');
    onCropped(null, true);
  }

  return (
    <div className="photo-field">
      <span className="field-label">Profile photo <span className="optional-label">OPTIONAL</span></span>
      <div className="photo-control">
        <div className={`photo-avatar${preview ? ' photo-avatar-filled' : ''}`}>
          {preview
            ? <img src={preview} alt="Cropped profile preview" />
            : <ImagePlus size={22} strokeWidth={1.6} />}
        </div>
        <div className="photo-details">
          <label className="button button-secondary photo-pick" htmlFor="profile-photo">
            <ImagePlus size={16} /> {preview ? 'Change photo' : 'Choose a photo'}
          </label>
          <input
            className="sr-only"
            id="profile-photo"
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={chooseFile}
          />
          <p>JPG, PNG, or WebP · Up to 5 MB</p>
        </div>
        {preview && (
          <button className="photo-remove" type="button" aria-label="Remove profile photo" onClick={clearPhoto}>
            <X size={17} />
          </button>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
      {source && (
        <div className="crop-backdrop" role="presentation">
          <div className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
            <div className="crop-dialog-head">
              <div><span className="form-kicker">A LITTLE PERSONAL TOUCH</span><h3 id="crop-title">Make it yours</h3></div>
              <button className="icon-button" type="button" aria-label="Close crop dialog" onClick={() => setSource('')}><X size={19} /></button>
            </div>
            <div className="crop-stage">
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <label className="zoom-control" htmlFor="photo-zoom">
              <span>ZOOM</span>
              <input id="photo-zoom" type="range" min="1" max="3" step="0.05" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <span>{zoom.toFixed(1)}×</span>
            </label>
            <div className="crop-actions">
              <button className="button button-ghost" type="button" onClick={() => setZoom(1)}><RotateCcw size={15} /> Reset</button>
              <button className="button button-primary" type="button" onClick={saveCrop}>Use this photo <span>→</span></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
