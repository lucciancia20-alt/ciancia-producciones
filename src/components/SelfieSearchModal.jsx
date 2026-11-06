import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Camera, Upload, Search, AlertCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { extractSelfieDescriptor, matchFaceAgainstAlbum, initFaceApi } from '../services/aiService';

/**
 * SelfieSearchModal
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   mediaItems: array of Firestore media docs
 *   onResults: (matchingIds: Set<string>, count: number) => void
 */
export default function SelfieSearchModal({ open, onClose, mediaItems = [], onResults }) {
  const [mode, setMode]                   = useState('idle'); // idle | camera | upload | analyzing | results | error
  const [errorMsg, setErrorMsg]           = useState('');
  const [matchCount, setMatchCount]       = useState(0);
  const [capturedImage, setCapturedImage] = useState(null);   // { src, isObjectUrl }
  const [loadingModels, setLoadingModels] = useState(false);

  const videoRef      = useRef(null);
  const streamRef     = useRef(null);
  const canvasRef     = useRef(null);
  const fileInputRef  = useRef(null);
  const objectUrlRef  = useRef(null);

  const revokePreviewUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Pre-warm models when modal opens + lock body scroll + Escape listener
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    setLoadingModels(true);
    initFaceApi({ forAdmin: false })
      .catch(() => {})
      .finally(() => setLoadingModels(false));

    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, onClose]);

  // Cleanup stream and preview URL on close
  useEffect(() => {
    if (!open) {
      stopCamera();
      revokePreviewUrl();
      setMode('idle');
      setErrorMsg('');
      setCapturedImage(null);
      setMatchCount(0);
    }
  }, [open, stopCamera, revokePreviewUrl]);

  // Liberar cámara y URL si el componente se desmonta
  useEffect(() => {
    return () => {
      stopCamera();
      revokePreviewUrl();
    };
  }, [stopCamera, revokePreviewUrl]);

  const startCamera = async () => {
    setErrorMsg('');
    setMode('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      stopCamera();
      setMode('error');
      if (err.name === 'NotAllowedError') {
        setErrorMsg('Permiso de cámara denegado. Habilitá el acceso a la cámara en tu navegador.');
      } else {
        setErrorMsg('No se pudo acceder a la cámara: ' + err.message);
      }
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    stopCamera();
    canvas.toBlob(blob => {
      if (!blob) {
        setMode('error');
        setErrorMsg('No se pudo capturar la imagen de la cámara.');
        return;
      }
      revokePreviewUrl();
      const src = canvas.toDataURL('image/jpeg');
      setCapturedImage({ src });
      analyzeImage(blob);
    }, 'image/jpeg', 0.9);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    revokePreviewUrl();
    const src = URL.createObjectURL(file);
    objectUrlRef.current = src;
    setCapturedImage({ src });
    analyzeImage(file);
  };

  const analyzeImage = async (fileOrBlob) => {
    setMode('analyzing');
    setErrorMsg('');
    try {
      const descriptor = await extractSelfieDescriptor(fileOrBlob);
      if (!descriptor) {
        setMode('error');
        setErrorMsg('No se detectó ningún rostro en la imagen. Intentá con una foto donde tu cara sea visible y esté bien iluminada.');
        return;
      }
      const matchingIds = await matchFaceAgainstAlbum(descriptor, mediaItems);
      setMatchCount(matchingIds.size);
      setMode('results');
      onResults(matchingIds, matchingIds.size);
    } catch (err) {
      setMode('error');
      setErrorMsg('Error al analizar la imagen: ' + err.message);
    }
  };

  const reset = () => {
    stopCamera();
    revokePreviewUrl();
    setCapturedImage(null);
    setErrorMsg('');
    setMatchCount(0);
    setMode('idle');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-dark-800 border border-dark-500 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-600">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🤳</span>
            <div>
              <h2 className="font-bold text-white">Buscarme por Selfie</h2>
              <p className="text-xs text-gray-400">IA busca tu rostro en el álbum</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-600 transition-colors"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {/* Loading models indicator */}
          {loadingModels && mode === 'idle' && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 mb-4 bg-yellow-400/10 rounded-lg px-3 py-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Cargando modelos de IA... (primera vez puede tardar ~10s)</span>
            </div>
          )}

          {/* IDLE MODE */}
          {mode === 'idle' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-300 text-center">
                Sacate una selfie o subí una foto tuya para encontrar<br />
                todas las imágenes del álbum donde aparecés.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={startCamera}
                  disabled={loadingModels}
                  className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-neon-green/40 hover:border-neon-green hover:bg-neon-green/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="p-3 rounded-full bg-dark-700 group-hover:bg-neon-green/10 transition-colors">
                    <Camera size={28} className="text-neon-green" />
                  </div>
                  <span className="text-sm font-medium text-gray-200">Usar Cámara</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loadingModels}
                  className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-dark-500 hover:border-neon-green/50 hover:bg-dark-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="p-3 rounded-full bg-dark-700 group-hover:bg-dark-600 transition-colors">
                    <Upload size={28} className="text-gray-300" />
                  </div>
                  <span className="text-sm font-medium text-gray-200">Subir Foto</span>
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <p className="text-xs text-gray-500 text-center">
                Tu imagen no se sube a ningún servidor — el análisis es 100% local en tu dispositivo.
              </p>
            </div>
          )}

          {/* CAMERA MODE */}
          {mode === 'camera' && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                  muted
                  playsInline
                />
                {/* Face guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-40 h-48 border-2 border-neon-green/60 rounded-full opacity-70" />
                </div>
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <p className="text-xs text-gray-400 text-center">Centrá tu cara en el círculo</p>
              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="flex-1 py-2.5 rounded-lg border border-dark-500 text-gray-300 hover:bg-dark-700 transition-colors text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={capturePhoto}
                  className="flex-1 py-2.5 rounded-lg bg-neon-green text-black font-bold hover:bg-neon-green/90 transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <Camera size={16} />
                  Capturar
                </button>
              </div>
            </div>
          )}

          {/* ANALYZING MODE */}
          {mode === 'analyzing' && (
            <div className="space-y-4">
              {capturedImage && (
                <img
                  src={capturedImage.src}
                  alt="Selfie capturada"
                  className="w-32 h-32 object-cover rounded-full mx-auto border-4 border-neon-green/40"
                />
              )}
              <div className="text-center space-y-3">
                <Loader2 size={32} className="animate-spin text-neon-green mx-auto" />
                <div>
                  <p className="font-medium text-white">Analizando con IA...</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Detectando rostro y comparando contra {mediaItems.length} fotos del álbum
                  </p>
                </div>
              </div>
              <div className="bg-dark-700 rounded-lg p-3 space-y-1.5">
                {['Detectando tu rostro', 'Extrayendo características faciales', 'Comparando contra el álbum'].map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin text-neon-green shrink-0" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RESULTS MODE */}
          {mode === 'results' && (
            <div className="space-y-4">
              {capturedImage && (
                <img
                  src={capturedImage.src}
                  alt="Tu selfie"
                  className="w-24 h-24 object-cover rounded-full mx-auto border-4 border-neon-green"
                />
              )}
              <div className="text-center">
                {matchCount > 0 ? (
                  <>
                    <CheckCircle size={40} className="text-neon-green mx-auto mb-2" />
                    <p className="text-xl font-bold text-white">
                      ¡{matchCount} foto{matchCount !== 1 ? 's' : ''} encontrada{matchCount !== 1 ? 's' : ''}!
                    </p>
                    <p className="text-sm text-gray-400 mt-1">
                      El álbum se filtró mostrando solo tus fotos.
                    </p>
                  </>
                ) : (
                  <>
                    <Search size={40} className="text-gray-500 mx-auto mb-2" />
                    <p className="text-lg font-bold text-white">Sin coincidencias</p>
                    <p className="text-sm text-gray-400 mt-1">
                      No encontramos tu rostro en este álbum. Probá con otra foto o ajustá la iluminación.
                    </p>
                  </>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="flex-1 py-2.5 rounded-lg border border-dark-500 text-gray-300 hover:bg-dark-700 transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} />
                  Intentar de nuevo
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg bg-neon-green text-black font-bold hover:bg-neon-green/90 transition-colors text-sm"
                >
                  {matchCount > 0 ? 'Ver mis fotos' : 'Cerrar'}
                </button>
              </div>
            </div>
          )}

          {/* ERROR MODE */}
          {mode === 'error' && (
            <div className="space-y-4">
              <div className="text-center">
                <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
                <p className="font-medium text-white">Ups, algo salió mal</p>
                <p className="text-sm text-gray-400 mt-2 leading-relaxed">{errorMsg}</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg border border-dark-500 text-gray-300 hover:bg-dark-700 transition-colors text-sm"
                >
                  Cerrar
                </button>
                <button
                  onClick={reset}
                  className="flex-1 py-2.5 rounded-lg bg-dark-700 text-white hover:bg-dark-600 transition-colors text-sm flex items-center justify-center gap-2"
                >
                  <RefreshCw size={14} />
                  Reintentar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
