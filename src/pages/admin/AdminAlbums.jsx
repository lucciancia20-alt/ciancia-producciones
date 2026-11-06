import React, { useEffect, useState, useRef } from 'react';
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, writeBatch, doc,
  Timestamp, query, orderBy, where,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Upload, X, Check, Loader2, Camera, Video,
  Eye, ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
  Bot, ScanFace, Save, Trash2, Tag,
} from 'lucide-react';
import { uploadToCloudinary } from '../../services/cloudinary';

// ─── Estados posibles de cada archivo en la cola ─────────────────────────────
// 'idle' | 'uploading' | 'done' | 'error'

export default function AdminAlbums() {
  const [albums, setAlbums]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [showCreate, setShowCreate]     = useState(false);
  const [creating, setCreating]         = useState(false);
  const [newAlbum, setNewAlbum]         = useState({
    title: '', category: 'Trail Running', location: '', description: '', coverUrl: '',
    pricePhoto: '', priceVideo: '',
  });
  const [uploadFiles, setUploadFiles]   = useState([]);   // { id, file, dorsals, status, progress, error, result }
  const [uploadAlbumId, setUploadAlbumId] = useState('');
  const [uploading, setUploading]       = useState(false);
  const [uploadSummary, setUploadSummary] = useState(null); // { ok, errors }
  const [expandedAlbum, setExpandedAlbum] = useState(null);
  const [albumMedia, setAlbumMedia]     = useState({});   // { [albumId]: media[] }
  const [mediaDorsalEdits, setMediaDorsalEdits] = useState({}); // { [mediaId]: string }
  const [mediaPriceEdits, setMediaPriceEdits]   = useState({}); // { [mediaId]: number|string }
  const [albumPriceEdits, setAlbumPriceEdits]   = useState({}); // { [albumId]: { pricePhoto, priceVideo } }
  const [savingMediaId, setSavingMediaId]       = useState(null);
  const [savingAlbumPriceId, setSavingAlbumPriceId] = useState(null);
  const [deletingAlbumId, setDeletingAlbumId] = useState(null);
  const [confirmDeleteAlbum, setConfirmDeleteAlbum] = useState(null);
  const [deletingMediaId, setDeletingMediaId] = useState(null);
  const [confirmDeleteMedia, setConfirmDeleteMedia] = useState(null);
  const dropRef = useRef(null);
  const uploadFilesRef = useRef([]);
  useEffect(() => { uploadFilesRef.current = uploadFiles; }, [uploadFiles]);

  // Espera a que termine el análisis IA de un ítem (máx. 90s) antes de subirlo
  const waitForAI = async (id, timeoutMs = 90000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const it = uploadFilesRef.current.find(f => f.id === id);
      if (!it || it.aiStatus !== 'analyzing') return it;
      await new Promise(r => setTimeout(r, 300));
    }
    return uploadFilesRef.current.find(f => f.id === id);
  };

  // ─── Edición manual de dorsales y precios en fotos ya subidas ───────────────
  const loadAlbumMedia = async (albumId) => {
    try {
      const snap = await getDocs(query(collection(db, 'media'), where('albumId', '==', albumId)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAlbumMedia(prev => ({ ...prev, [albumId]: list }));
      setMediaDorsalEdits(prev => {
        const next = { ...prev };
        list.forEach(m => { next[m.id] = (m.dorsals || []).join(', '); });
        return next;
      });
      setMediaPriceEdits(prev => {
        const next = { ...prev };
        list.forEach(m => {
          next[m.id] = m.price ?? (m.type === 'video' ? 3000 : 2000);
        });
        return next;
      });
    } catch (e) { console.error(e); }
  };

  const toggleAlbum = (albumId) => {
    const next = expandedAlbum === albumId ? null : albumId;
    setExpandedAlbum(next);
    if (next && !albumMedia[next]) loadAlbumMedia(next);
  };

  const saveMediaItem = async (albumId, mediaId) => {
    setSavingMediaId(mediaId);
    try {
      const dorsals = [...new Set((mediaDorsalEdits[mediaId] || '').split(',').map(d => d.trim()).filter(Boolean))];
      const m = albumMedia[albumId]?.find(item => item.id === mediaId);
      const defaultP = m?.type === 'video' ? 3000 : 2000;
      const rawPrice = mediaPriceEdits[mediaId];
      const price = Number(rawPrice) > 0 ? Number(rawPrice) : (m?.price || defaultP);

      await updateDoc(doc(db, 'media', mediaId), { dorsals, price });
      setAlbumMedia(prev => ({
        ...prev,
        [albumId]: (prev[albumId] || []).map(item => item.id === mediaId ? { ...item, dorsals, price } : item),
      }));
    } catch (e) { alert('Error guardando cambios: ' + e.message); }
    finally { setSavingMediaId(null); }
  };

  const saveAlbumPrices = async (albumId) => {
    setSavingAlbumPriceId(albumId);
    try {
      const edits = albumPriceEdits[albumId] || {};
      const current = albums.find(a => a.id === albumId);
      const pricePhoto = edits.pricePhoto !== undefined && edits.pricePhoto !== ''
        ? Number(edits.pricePhoto)
        : (Number(current?.pricePhoto) || 2000);
      const priceVideo = edits.priceVideo !== undefined && edits.priceVideo !== ''
        ? Number(edits.priceVideo)
        : (Number(current?.priceVideo) || 3000);

      await updateDoc(doc(db, 'albums', albumId), { pricePhoto, priceVideo });
      setAlbums(prev => prev.map(a => a.id === albumId ? { ...a, pricePhoto, priceVideo } : a));
    } catch (e) {
      alert('Error guardando precios del álbum: ' + e.message);
    } finally {
      setSavingAlbumPriceId(null);
    }
  };

  // Bloqueo de scroll y soporte tecla Escape para los modales de confirmación de eliminación
  useEffect(() => {
    if (!confirmDeleteAlbum && !confirmDeleteMedia) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!deletingAlbumId && confirmDeleteAlbum) setConfirmDeleteAlbum(null);
        if (!deletingMediaId && confirmDeleteMedia) setConfirmDeleteMedia(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirmDeleteAlbum, confirmDeleteMedia, deletingAlbumId, deletingMediaId]);

  // ─── Eliminar una foto/video individual de un álbum ─────────────────────────
  const handleDeleteMedia = async (albumId, mediaItem) => {
    if (!albumId || !mediaItem) return;
    setDeletingMediaId(mediaItem.id);
    try {
      await deleteDoc(doc(db, 'media', mediaItem.id));

      try {
        await deleteDoc(doc(db, 'albums', albumId, 'media', mediaItem.id));
      } catch {
        // noop
      }

      const targetAlbum = albums.find(a => a.id === albumId);
      const nextCount = Math.max(0, (targetAlbum?.totalMedia || 1) - 1);
      await updateDoc(doc(db, 'albums', albumId), { totalMedia: nextCount });

      setAlbumMedia(prev => ({
        ...prev,
        [albumId]: (prev[albumId] || []).filter(m => m.id !== mediaItem.id),
      }));
      setAlbums(prev => prev.map(a => a.id === albumId ? { ...a, totalMedia: nextCount } : a));
      setMediaDorsalEdits(prev => {
        const next = { ...prev };
        delete next[mediaItem.id];
        return next;
      });
      setMediaPriceEdits(prev => {
        const next = { ...prev };
        delete next[mediaItem.id];
        return next;
      });

      setConfirmDeleteMedia(null);
    } catch (err) {
      console.error('[handleDeleteMedia] Error:', err);
      alert('Error al eliminar la foto: ' + (err.message || 'Ocurrió un error inesperado'));
    } finally {
      setDeletingMediaId(null);
    }
  };

  // ─── Eliminar álbum y sus fotos asociadas en Firestore ──────────────────────
  const handleDeleteAlbum = async (album) => {
    if (!album) return;
    setDeletingAlbumId(album.id);
    try {
      // 1. Buscar registros en la colección raíz 'media'
      const mediaSnap = await getDocs(query(collection(db, 'media'), where('albumId', '==', album.id)));

      // 2. Chequear si hay registros en la subcolección 'albums/{albumId}/media'
      let subMediaSnap = null;
      try {
        subMediaSnap = await getDocs(collection(db, 'albums', album.id, 'media'));
      } catch {
        // noop
      }

      const allMediaDocs = [...mediaSnap.docs];
      if (subMediaSnap && !subMediaSnap.empty) {
        allMediaDocs.push(...subMediaSnap.docs);
      }

      // 3. Borrar media en lotes writeBatch
      const BATCH_SIZE = 400;
      for (let i = 0; i < allMediaDocs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = allMediaDocs.slice(i, i + BATCH_SIZE);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // 4. Borrar el documento principal del álbum
      await deleteDoc(doc(db, 'albums', album.id));

      // 5. Actualizar estado local
      setAlbums(prev => prev.filter(a => a.id !== album.id));
      if (uploadAlbumId === album.id) {
        setUploadAlbumId('');
      }
      if (expandedAlbum === album.id) {
        setExpandedAlbum(null);
      }
      setAlbumMedia(prev => {
        const next = { ...prev };
        delete next[album.id];
        return next;
      });

      setConfirmDeleteAlbum(null);
    } catch (err) {
      console.error('[handleDeleteAlbum] Error:', err);
      alert('Error al eliminar el álbum: ' + (err.message || 'Ocurrió un error inesperado'));
    } finally {
      setDeletingAlbumId(null);
    }
  };

  const CATEGORIES = ['Trail Running', 'Ciclismo', 'Fútbol', 'Dron', 'Natación', 'Atletismo', 'Otro'];

  useEffect(() => {
    loadAlbums();

    // Evitar que arrastrar archivos fuera del área abra la imagen en una pestaña nueva
    const preventWindowDrop = (e) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventWindowDrop);
    window.addEventListener('drop', preventWindowDrop);
    return () => {
      window.removeEventListener('dragover', preventWindowDrop);
      window.removeEventListener('drop', preventWindowDrop);
    };
  }, []);

  async function loadAlbums() {
    try {
      const snap = await getDocs(query(collection(db, 'albums'), orderBy('createdAt', 'desc')));
      setAlbums(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // ─── Crear álbum ────────────────────────────────────────────────────────────
  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const pricePhoto = newAlbum.pricePhoto ? Number(newAlbum.pricePhoto) : 2000;
      const priceVideo = newAlbum.priceVideo ? Number(newAlbum.priceVideo) : 3000;
      const albumData = {
        ...newAlbum,
        pricePhoto,
        priceVideo,
        date: Timestamp.now(),
        totalMedia: 0,
        published: true,
        createdAt: Timestamp.now(),
      };
      const docRef = await addDoc(collection(db, 'albums'), albumData);
      setAlbums(prev => [{ id: docRef.id, ...albumData }, ...prev]);
      setNewAlbum({ title: '', category: 'Trail Running', location: '', description: '', coverUrl: '', pricePhoto: '', priceVideo: '' });
      setShowCreate(false);
    } catch (e) { alert('Error: ' + e.message); }
    finally { setCreating(false); }
  };

  // ─── Gestión de la cola de archivos ─────────────────────────────────────────
  const addFiles = (rawFiles) => {
    const accepted = rawFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const items = accepted.map(f => ({
      id:              Math.random().toString(36).slice(2),
      file:            f,
      dorsals:         '',
      dorsalsTouched:  false,       // true si el admin editó el input a mano
      status:          'idle',
      progress:        0,
      error:           null,
      result:          null,
      // IA (solo imágenes)
      aiStatus:        f.type.startsWith('image/') ? 'analyzing' : 'skipped', // analyzing | done | error | skipped
      aiDorsals:       [],
      faceDescriptors: [],
    }));
    setUploadFiles(prev => [...prev, ...items]);

    // Análisis IA automático en segundo plano (import 100% dinámico)
    items.filter(it => it.aiStatus === 'analyzing').forEach(async (it) => {
      try {
        const { analyzeImageFile } = await import('../../services/aiService');
        const { dorsals, faceDescriptors } = await analyzeImageFile(it.file);
        setUploadFiles(prev => prev.map(f => {
          if (f.id !== it.id) return f;
          return {
            ...f,
            aiStatus: 'done',
            aiDorsals: dorsals,
            faceDescriptors,
            // Sugerencia editable: solo si el admin no escribió nada a mano
            dorsals: !f.dorsalsTouched && !f.dorsals.trim() ? dorsals.join(', ') : f.dorsals,
          };
        }));
      } catch (err) {
        console.warn('[AdminAlbums] IA falló', err);
        patchFile(it.id, { aiStatus: 'error' });
      }
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploading) return;
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleFileSelect = (e) => {
    addFiles(Array.from(e.target.files));
    e.target.value = '';   // reset para poder seleccionar los mismos archivos otra vez
  };

  const updateDorsals = (id, val) =>
    setUploadFiles(prev => prev.map(f => f.id === id ? { ...f, dorsals: val, dorsalsTouched: true } : f));

  const removeFile = (id) =>
    setUploadFiles(prev => prev.filter(f => f.id !== id));

  const patchFile = (id, patch) =>
    setUploadFiles(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));

  // ─── Subida a Cloudinary + guardado en Firestore ─────────────────────────────
  const handleUpload = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!uploadAlbumId)        { alert('Seleccioná un álbum de destino'); return; }
    if (!uploadFiles.length)   { alert('Agregá al menos un archivo');     return; }
    if (uploading)             return;

    setUploading(true);
    setUploadSummary(null);

    const album = albums.find(a => a.id === uploadAlbumId);
    const folder = `ciancia/${album?.slug || uploadAlbumId}`;

    let ok = 0;
    let errors = 0;

    // ── Subimos en paralelo (hasta 4 concurrentes) para ir más rápido ──────────
    const CONCURRENCY = 4;
    // Usar el estado más reciente (incluye resultados de IA ya terminados)
    const queue = [...uploadFilesRef.current].filter(f => f.status === 'idle');

    async function processOne(queued) {
      // Si la IA sigue analizando esta imagen, esperamos su resultado
      if (queued.aiStatus === 'analyzing') {
        patchFile(queued.id, { status: 'waiting-ai' });
        await waitForAI(queued.id);
      }
      // Releer el ítem por si la IA terminó mientras esperaba en la cola
      const item = uploadFilesRef.current.find(f => f.id === queued.id) || queued;
      patchFile(item.id, { status: 'uploading', progress: 0, error: null });
      const isVideo  = item.file.type.startsWith('video/');
      const dorsalList = [...new Set(item.dorsals.split(',').map(d => d.trim()).filter(Boolean))];

      try {
        // 1) Subida a Cloudinary con reporte de progreso
        const result = await uploadToCloudinary(item.file, {
          folder,
          onProgress: (pct) => patchFile(item.id, { progress: pct }),
        });

        patchFile(item.id, { status: 'done', progress: 100, result });

        const albumPhotoPrice = Number(album?.pricePhoto) || 2000;
        const albumVideoPrice = Number(album?.priceVideo) || 3000;
        const finalPrice = isVideo ? albumVideoPrice : albumPhotoPrice;

        // 2) Guardado en Firestore (URL pública optimizada, NO base64)
        await addDoc(collection(db, 'media'), {
          type:        isVideo ? 'video' : 'photo',
          fileName:    item.file.name,
          url:         result.url,         // URL HD optimizada (f_auto,q_auto)
          thumb:       result.thumb,       // Thumbnail 400px
          publicId:    result.publicId,    // Para futuras transformaciones
          duration:    result.duration || null,
          dorsals:     dorsalList,
          aiDorsals:   item.aiDorsals || [],
          // Array de objetos planos { vector: number[] } — Firestore no admite number[][]
          faceDescriptors: (item.faceDescriptors || []).map(d =>
            Array.isArray(d) ? { vector: Array.from(d) } : { vector: Array.from(d.vector) }
          ),
          facesCount:  (item.faceDescriptors || []).length,
          albumId:     uploadAlbumId,
          albumSlug:   album?.slug  || '',
          albumTitle:  album?.title || '',
          price:       finalPrice,
          approved:    true,
          createdAt:   Timestamp.now(),
        });

        ok++;
      } catch (err) {
        patchFile(item.id, { status: 'error', error: err.message });
        errors++;
      }
    }

    // Procesar con concurrencia limitada
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processOne));
    }

    // 3) Actualizar contador del álbum en Firestore y reflejarlo de inmediato en el estado
    if (ok > 0) {
      const albumUpdates = {
        totalMedia: (album?.totalMedia || 0) + ok,
      };

      // Si el álbum aún no tenía foto de portada asignada, tomamos la primera foto subida
      const firstDone = uploadFilesRef.current.find(f => f.status === 'done')?.result?.thumb;
      if (!album?.coverUrl && firstDone) {
        albumUpdates.coverUrl = firstDone;
      }

      await updateDoc(doc(db, 'albums', uploadAlbumId), albumUpdates);
      // Actualizar contador y portada del álbum en el estado local de forma fluida
      setAlbums(prev => prev.map(a => a.id === uploadAlbumId ? { ...a, ...albumUpdates } : a));
    }

    setUploadSummary({ ok, errors });
    setUploading(false);

    // Limpiar solo los exitosos; dejar los errores para reintentar sin recargar ni salir de la vista
    setUploadFiles(prev => prev.filter(f => f.status !== 'done'));
    loadAlbums();

    // Refrescar la lista de fotos del álbum si el usuario la tiene expandida
    if (ok > 0) {
      if (expandedAlbum === uploadAlbumId) {
        loadAlbumMedia(uploadAlbumId);
      } else {
        setAlbumMedia(prev => { const n = { ...prev }; delete n[uploadAlbumId]; return n; });
      }
    }
  };

  const clearAll   = () => { setUploadFiles([]); setUploadSummary(null); };
  const retryErrors = () =>
    setUploadFiles(prev => prev.map(f => f.status === 'error' ? { ...f, status: 'idle', progress: 0, error: null } : f));

  const hasErrors   = uploadFiles.some(f => f.status === 'error');
  const idleCount   = uploadFiles.filter(f => f.status === 'idle').length;
  const doneCount   = uploadFiles.filter(f => f.status === 'done').length;
  const totalCount  = uploadFiles.length;

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-dark-900 p-4 pt-6">
      <div className="max-w-6xl mx-auto">
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-dark-800 border border-dark-600 text-gray-300 hover:text-neon-green hover:border-neon-green/50 transition-all mb-6 text-sm font-semibold shadow-sm group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Volver al Dashboard
        </Link>

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-black text-white">
            GESTIÓN DE <span className="text-neon-green">ÁLBUMES</span>
          </h1>
          <button onClick={() => setShowCreate(!showCreate)} className="btn-neon flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nuevo álbum
          </button>
        </div>

        {/* ── Crear álbum ───────────────────────────────────────────────────── */}
        {showCreate && (
          <form onSubmit={handleCreateAlbum} className="card-dark p-6 mb-8 border-neon-green/30 space-y-4">
            <h2 className="font-bold text-white text-lg">Crear nuevo álbum</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Título *</label>
                <input value={newAlbum.title} onChange={e => setNewAlbum(p => ({ ...p, title: e.target.value }))} placeholder="Trail Running..." className="input-dark" required />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Categoría</label>
                <select value={newAlbum.category} onChange={e => setNewAlbum(p => ({ ...p, category: e.target.value }))} className="input-dark">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Ubicación</label>
                <input value={newAlbum.location} onChange={e => setNewAlbum(p => ({ ...p, location: e.target.value }))} placeholder="Córdoba, Argentina" className="input-dark" />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">URL de portada</label>
                <input value={newAlbum.coverUrl} onChange={e => setNewAlbum(p => ({ ...p, coverUrl: e.target.value }))} placeholder="https://..." className="input-dark" />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Precio Fotos ($) — opcional</label>
                <input
                  type="number"
                  value={newAlbum.pricePhoto}
                  onChange={e => setNewAlbum(p => ({ ...p, pricePhoto: e.target.value }))}
                  placeholder="Por defecto: $2.000"
                  className="input-dark font-mono"
                />
              </div>
              <div>
                <label className="text-sm text-gray-400 mb-1 block">Precio Videos / Dron ($) — opcional</label>
                <input
                  type="number"
                  value={newAlbum.priceVideo}
                  onChange={e => setNewAlbum(p => ({ ...p, priceVideo: e.target.value }))}
                  placeholder="Por defecto: $3.000"
                  className="input-dark font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Descripción</label>
              <textarea value={newAlbum.description} onChange={e => setNewAlbum(p => ({ ...p, description: e.target.value }))} placeholder="Descripción del evento..." className="input-dark resize-none h-20" />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={creating} className="btn-neon flex items-center gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Crear álbum
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="btn-outline-neon">Cancelar</button>
            </div>
          </form>
        )}

        {/* ── Zona de carga ─────────────────────────────────────────────────── */}
        <div className="card-dark p-6 mb-8">
          {/* Header de la sección */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-white text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-neon-green" /> Carga masiva — Cloudinary
            </h2>
            {/* Badge de Cloudinary */}
            <span className="text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 px-2 py-1 rounded-full font-medium">
              ☁ khzko7rr · ciancia_uploads
            </span>
          </div>

          {/* Selector de álbum */}
          <div className="mb-4">
            <label className="text-sm text-gray-400 mb-1 block">Álbum destino</label>
            <select value={uploadAlbumId} onChange={e => setUploadAlbumId(e.target.value)} className="input-dark max-w-md" disabled={uploading}>
              <option value="">Seleccioná un álbum...</option>
              {albums.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </select>
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onClick={() => !uploading && document.getElementById('cloudFileInput').click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors select-none
              ${uploading
                ? 'border-dark-500 cursor-not-allowed opacity-50'
                : 'border-dark-400 hover:border-neon-green/60 cursor-pointer'
              }`}
          >
            <Upload className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">Arrastrá fotos/videos aquí o hacé click para seleccionar</p>
            <p className="text-gray-600 text-sm mt-1">JPG, PNG, WEBP, MP4, MOV, AVI — se suben directamente a Cloudinary</p>
            <input id="cloudFileInput" type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" disabled={uploading} />
          </div>

          {/* ── Lista de archivos con progreso ──────────────────────────────── */}
          {uploadFiles.length > 0 && (
            <div className="mt-5 space-y-3">

              {uploadFiles.map(item => {
                const isVideo = item.file.type.startsWith('video/');
                const sizeMB  = (item.file.size / 1024 / 1024).toFixed(1);

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-4 transition-colors space-y-3 ${
                      item.status === 'done'  ? 'bg-green-900/15 border-green-500/30' :
                      item.status === 'error' ? 'bg-red-900/15   border-red-500/30'   :
                                                'bg-dark-700     border-dark-500'
                    }`}
                  >
                    {/* Fila 1: Ícono, Nombre del archivo, tamaño y botón eliminar */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="flex-shrink-0 p-2 bg-dark-600 rounded-xl">
                          {isVideo
                            ? <Video  className="w-5 h-5 text-neon-green" />
                            : <Camera className="w-5 h-5 text-blue-400"   />
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white text-sm font-semibold truncate leading-tight">{item.file.name}</p>
                          <p className="text-gray-400 text-xs mt-0.5">{sizeMB} MB · {isVideo ? 'Video' : 'Imagen'}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeFile(item.id)}
                        disabled={item.status === 'uploading'}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-dark-600 rounded-lg transition-colors disabled:opacity-30 flex-shrink-0"
                        title="Quitar archivo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Barra de progreso de subida a Cloudinary */}
                    {(item.status === 'uploading' || item.status === 'done') && (
                      <div className="w-full h-1.5 rounded-full bg-dark-500 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-200 ${
                            item.status === 'done' ? 'bg-green-400' : 'bg-neon-green'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    )}

                    {/* Fila 2: Indicador rectangular alargado de IA / Estados */}
                    <div className="w-full space-y-1.5">
                      {item.aiStatus === 'analyzing' && (
                        <div className="w-full flex items-center gap-2.5 text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3.5 py-2.5 shadow-sm">
                          <Loader2 className="w-4 h-4 animate-spin text-yellow-400 flex-shrink-0" />
                          <span className="font-semibold tracking-wide">Analizando dorsales y rostros con IA...</span>
                        </div>
                      )}

                      {item.aiStatus === 'done' && (
                        <div className="w-full flex items-center justify-between gap-2 text-xs text-neon-green bg-neon-green/10 border border-neon-green/30 rounded-xl px-3.5 py-2 shadow-sm">
                          <div className="flex items-center gap-2">
                            <Bot className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold">{item.aiDorsals.length} dorsal{item.aiDorsals.length !== 1 ? 'es' : ''}</span>
                            <span className="opacity-40">·</span>
                            <ScanFace className="w-4 h-4 flex-shrink-0" />
                            <span className="font-semibold">{item.faceDescriptors.length} rostro{item.faceDescriptors.length !== 1 ? 's' : ''}</span>
                          </div>
                          {item.aiDorsals.length > 0 && (
                            <span className="text-[11px] text-gray-400 font-mono hidden xs:inline">
                              [{item.aiDorsals.join(', ')}]
                            </span>
                          )}
                        </div>
                      )}

                      {item.aiStatus === 'error' && (
                        <div className="w-full flex items-center gap-2 text-xs text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-xl px-3.5 py-2">
                          <AlertCircle className="w-4 h-4 text-orange-400 flex-shrink-0" />
                          <span>Sin IA — podés ingresar los dorsales manualmente</span>
                        </div>
                      )}

                      {item.status === 'uploading' && (
                        <p className="text-xs text-neon-green animate-pulse font-medium">Subiendo a Cloudinary… {item.progress}%</p>
                      )}

                      {item.status === 'done' && (
                        <div className="text-xs text-green-400 flex items-center gap-1.5 font-medium">
                          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                          <span>Subido correctamente</span>
                          {item.result?.publicId && (
                            <a href={item.result.url} target="_blank" rel="noreferrer"
                              className="ml-2 text-blue-400 hover:underline" onClick={e => e.stopPropagation()}>
                              Ver en Cloudinary ↗
                            </a>
                          )}
                        </div>
                      )}

                      {item.status === 'error' && (
                        <div className="text-xs text-red-400 flex items-center gap-1.5 font-medium">
                          <AlertCircle className="w-4 h-4 flex-shrink-0" />
                          <span>{item.error}</span>
                        </div>
                      )}
                    </div>

                    {/* Fila 3: Input de dorsales con ancho completo */}
                    <div className="w-full pt-0.5">
                      <div className="relative flex items-center">
                        <input
                          type="text"
                          placeholder={item.aiStatus === 'analyzing' ? 'IA leyendo dorsales…' : 'Dorsales (ej: 101, 102)'}
                          value={item.dorsals}
                          onChange={e => updateDorsals(item.id, e.target.value)}
                          disabled={item.status === 'uploading' || item.status === 'done' || item.status === 'waiting-ai'}
                          className={`input-dark text-sm py-2 px-3 pr-8 w-full font-mono disabled:opacity-50 ${
                            item.aiStatus === 'done' && !item.dorsalsTouched && item.dorsals ? 'border-neon-green/60 ring-1 ring-neon-green/30' : ''
                          }`}
                        />
                        {item.dorsals && item.status !== 'uploading' && item.status !== 'done' && (
                          <button
                            type="button"
                            onClick={() => updateDorsals(item.id, '')}
                            title="Limpiar dorsales"
                            className="absolute right-2 text-gray-400 hover:text-red-400 transition-colors text-xs font-bold p-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {item.aiStatus === 'done' && !item.dorsalsTouched && item.dorsals && (
                        <p className="text-[11px] text-neon-green/80 mt-1 pl-1">✓ Dorsales detectados automáticamente por IA (editables)</p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ── Acciones ──────────────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading || idleCount === 0}
                  className="btn-neon flex items-center gap-2"
                >
                  {uploading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Subiendo…</>
                    : <><Upload className="w-4 h-4" /> Subir {idleCount} archivo{idleCount !== 1 ? 's' : ''} a Cloudinary</>
                  }
                </button>

                {hasErrors && !uploading && (
                  <button type="button" onClick={retryErrors} className="btn-outline-neon text-sm py-2 flex items-center gap-2">
                    <Loader2 className="w-4 h-4" /> Reintentar errores
                  </button>
                )}

                {!uploading && (
                  <button type="button" onClick={clearAll} className="text-gray-500 hover:text-red-400 text-sm transition-colors">
                    Limpiar todo
                  </button>
                )}

                {/* Contador rápido */}
                {totalCount > 0 && (
                  <span className="text-gray-500 text-xs ml-auto">
                    {doneCount}/{totalCount} completados
                    {hasErrors && ` · ${uploadFiles.filter(f => f.status === 'error').length} error(es)`}
                  </span>
                )}
              </div>

              {/* Resumen final */}
              {uploadSummary && !uploading && (
                <div className={`rounded-lg p-4 border flex items-start gap-3 text-sm ${
                  uploadSummary.errors === 0
                    ? 'bg-green-900/20 border-green-500/30 text-green-300'
                    : 'bg-yellow-900/20 border-yellow-500/30 text-yellow-300'
                }`}>
                  {uploadSummary.errors === 0
                    ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    : <AlertCircle  className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  }
                  <div>
                    <p className="font-semibold">
                      {uploadSummary.ok > 0 && `✅ ${uploadSummary.ok} archivo${uploadSummary.ok !== 1 ? 's' : ''} subido${uploadSummary.ok !== 1 ? 's' : ''} a Cloudinary y vinculados en Firestore.`}
                    </p>
                    {uploadSummary.errors > 0 && (
                      <p className="mt-0.5">⚠️ {uploadSummary.errors} archivo{uploadSummary.errors !== 1 ? 's' : ''} fallaron. Revisá la consola o reintentá.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Lista de álbumes ──────────────────────────────────────────────── */}
        <h2 className="text-xl font-black text-white mb-4">ÁLBUMES EXISTENTES ({albums.length})</h2>

        {loading ? (
          <div className="text-neon-green animate-pulse">Cargando…</div>
        ) : (
          <div className="space-y-3">
            {albums.map(album => (
              <div key={album.id} className="card-dark border border-dark-500">
                <div className="p-4 flex items-center gap-4">
                  <img
                    src={album.coverUrl || 'https://placehold.co/80x60/1a1a1a/39FF14?text=Sin+portada'}
                    alt={album.title}
                    className="w-16 h-12 object-cover rounded-lg flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white truncate">{album.title}</h3>
                    <p className="text-gray-400 text-xs">{album.category} · {album.location} · {album.totalMedia || 0} archivos</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link to={`/album/${album.id}`} target="_blank" className="p-2 text-gray-400 hover:text-neon-green transition-colors" title="Ver álbum">
                      <Eye className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => toggleAlbum(album.id)}
                      className="p-2 text-gray-400 hover:text-neon-green transition-colors"
                      title={expandedAlbum === album.id ? 'Ocultar detalles' : 'Ver detalles'}
                    >
                      {expandedAlbum === album.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAlbum(album)}
                      disabled={deletingAlbumId === album.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 hover:border-red-500/60 transition-colors disabled:opacity-40"
                      title="Eliminar álbum 🗑️"
                    >
                      {deletingAlbumId === album.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Eliminar 🗑️</span>
                    </button>
                  </div>
                </div>

                {expandedAlbum === album.id && (
                  <div className="border-t border-dark-600 p-4 text-sm text-gray-400 space-y-2">
                    <p><strong className="text-white">ID Firestore:</strong> {album.id}</p>
                    {album.slug && <p><strong className="text-white">Slug:</strong> {album.slug}</p>}
                    <p><strong className="text-white">Descripción:</strong> {album.description || '—'}</p>

                    {/* Precios específicos de este álbum */}
                    <div className="bg-dark-700/60 rounded-xl p-3 border border-dark-600 mt-2 space-y-2">
                      <p className="text-white text-xs font-bold flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-neon-green" /> Precios específicos para este álbum:
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400">Fotos: $</span>
                          <input
                            type="number"
                            value={albumPriceEdits[album.id]?.pricePhoto ?? album.pricePhoto ?? 2000}
                            onChange={e => setAlbumPriceEdits(prev => ({
                              ...prev,
                              [album.id]: { ...(prev[album.id] || {}), pricePhoto: e.target.value }
                            }))}
                            className="input-dark text-xs py-1 px-2 w-24 font-mono"
                            placeholder="2000"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400">Videos: $</span>
                          <input
                            type="number"
                            value={albumPriceEdits[album.id]?.priceVideo ?? album.priceVideo ?? 3000}
                            onChange={e => setAlbumPriceEdits(prev => ({
                              ...prev,
                              [album.id]: { ...(prev[album.id] || {}), priceVideo: e.target.value }
                            }))}
                            className="input-dark text-xs py-1 px-2 w-24 font-mono"
                            placeholder="3000"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => saveAlbumPrices(album.id)}
                          disabled={savingAlbumPriceId === album.id}
                          className="btn-outline-neon text-xs py-1 px-3 flex items-center gap-1.5"
                        >
                          {savingAlbumPriceId === album.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Guardar precios del álbum
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setUploadAlbumId(album.id);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="text-neon-green hover:underline text-xs flex items-center gap-1 mt-2"
                    >
                      <Upload className="w-3 h-3" /> Subir archivos a este álbum
                    </button>

                    {/* ── Edición manual de dorsales y precios ─────────────────── */}
                    <div className="pt-3 mt-3 border-t border-dark-600">
                      <p className="text-white font-semibold mb-2 flex items-center gap-2">
                        <Bot className="w-4 h-4 text-neon-green" /> Dorsales y Precios por archivo
                        <span className="text-xs text-gray-500 font-normal">(corregí dorsales o ajustá precios individuales)</span>
                      </p>
                      {!albumMedia[album.id] ? (
                        <p className="text-neon-green animate-pulse text-xs">Cargando archivos…</p>
                      ) : albumMedia[album.id].length === 0 ? (
                        <p className="text-xs text-gray-500">Este álbum todavía no tiene archivos.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                          {albumMedia[album.id].map(m => {
                            const originalDorsals = (m.dorsals || []).join(', ');
                            const originalPrice = m.price !== undefined && m.price !== null ? String(m.price) : (m.type === 'video' ? '3000' : '2000');
                            const currentDorsals = mediaDorsalEdits[m.id] ?? originalDorsals;
                            const currentPrice = mediaPriceEdits[m.id] ?? originalPrice;
                            const dirty = currentDorsals !== originalDorsals || String(currentPrice) !== String(originalPrice);
                            return (
                              <div key={m.id} className="flex items-center gap-2 bg-dark-700 rounded-lg p-2 border border-dark-500">
                                <img
                                  src={m.thumb || m.url}
                                  alt={m.fileName}
                                  className="w-14 h-10 object-cover rounded flex-shrink-0"
                                  draggable={false}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-gray-300 truncate">{m.fileName}</p>
                                  <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                    {m.type === 'video' ? <Video className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                                    {m.type === 'photo' && <><ScanFace className="w-3 h-3 ml-1" /> {m.facesCount ?? (m.faceDescriptors?.length || 0)} rostro(s)</>}
                                  </p>
                                </div>
                                <div className="relative flex items-center" title="Dorsales separados por coma">
                                  <input
                                    value={currentDorsals}
                                    onChange={e => setMediaDorsalEdits(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    placeholder="Sin dorsales"
                                    className="input-dark text-xs py-1 pr-6 w-24"
                                  />
                                  {currentDorsals && (
                                    <button
                                      type="button"
                                      onClick={() => setMediaDorsalEdits(prev => ({ ...prev, [m.id]: '' }))}
                                      title="Limpiar dorsales"
                                      className="absolute right-1.5 text-gray-400 hover:text-red-400 text-xs font-bold"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 bg-dark-800 px-1.5 py-0.5 rounded border border-dark-600" title="Precio individual ($)">
                                  <span className="text-gray-400 text-[11px]">$</span>
                                  <input
                                    type="number"
                                    value={currentPrice}
                                    onChange={e => setMediaPriceEdits(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    placeholder={m.type === 'video' ? '3000' : '2000'}
                                    className="bg-transparent text-white text-xs w-14 font-mono focus:outline-none"
                                    min="0"
                                    step="100"
                                  />
                                </div>
                                <button
                                  onClick={() => saveMediaItem(album.id, m.id)}
                                  disabled={!dirty || savingMediaId === m.id}
                                  title="Guardar cambios (dorsal y precio)"
                                  className="p-1.5 rounded text-neon-green hover:bg-neon-green/10 disabled:opacity-30 disabled:hover:bg-transparent"
                                >
                                  {savingMediaId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteMedia({ albumId: album.id, media: m })}
                                  disabled={deletingMediaId === m.id}
                                  title="Eliminar esta foto del álbum 🗑️"
                                  className="p-1.5 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                                >
                                  {deletingMediaId === m.id ? <Loader2 className="w-4 h-4 animate-spin text-red-400" /> : <Trash2 className="w-4 h-4" />}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal de confirmación para eliminar álbum ── */}
      {confirmDeleteAlbum && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => { if (!deletingAlbumId) setConfirmDeleteAlbum(null); }}
        >
          <div
            className="bg-dark-800 border border-red-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-3 bg-red-500/10 rounded-full border border-red-500/30 flex-shrink-0">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-white text-lg">¿Eliminar álbum?</h3>
                <p className="text-xs text-red-400/90 font-medium">Esta acción no se puede deshacer</p>
              </div>
            </div>

            <p className="text-gray-300 text-sm mb-4 leading-relaxed">
              ¿Estás seguro de eliminar el álbum <strong className="text-white">"{confirmDeleteAlbum.title}"</strong> y todo su contenido asociado en Firestore?
            </p>

            <div className="bg-dark-700/80 rounded-xl p-3.5 border border-dark-600 mb-6 text-xs text-gray-400 space-y-1.5">
              <p>• Categoría: <span className="text-white font-medium">{confirmDeleteAlbum.category || '—'}</span></p>
              <p>• Archivos registrados: <span className="text-white font-medium">{confirmDeleteAlbum.totalMedia || 0}</span></p>
              <p className="text-yellow-400/90 pt-1 font-medium">
                ⚠️ Se eliminarán de forma definitiva los registros de fotos y videos vinculados a este álbum en la base de datos.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteAlbum(null)}
                disabled={deletingAlbumId !== null}
                className="btn-outline-neon flex-1 text-sm py-2.5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteAlbum(confirmDeleteAlbum)}
                disabled={deletingAlbumId !== null}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {deletingAlbumId ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Eliminando…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Eliminar definitivamente
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de confirmación rápido para eliminar foto individual ── */}
      {confirmDeleteMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => { if (!deletingMediaId) setConfirmDeleteMedia(null); }}
        >
          <div
            className="bg-dark-800 border border-red-500/40 rounded-2xl p-6 max-w-sm w-full shadow-2xl relative"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-400 mb-4">
              <div className="p-2.5 bg-red-500/10 rounded-full border border-red-500/30 flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-white text-base">¿Eliminar esta foto del álbum?</h3>
                <p className="text-xs text-red-400/90 font-medium">Se quitará del catálogo de inmediato</p>
              </div>
            </div>

            <div className="flex items-center gap-3 bg-dark-700/80 rounded-xl p-3 border border-dark-600 mb-5">
              <img
                src={confirmDeleteMedia.media.thumb || confirmDeleteMedia.media.url}
                alt={confirmDeleteMedia.media.fileName}
                className="w-16 h-12 object-cover rounded-lg flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-semibold truncate">{confirmDeleteMedia.media.fileName}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {confirmDeleteMedia.media.dorsals?.length
                    ? `Dorsales: ${confirmDeleteMedia.media.dorsals.join(', ')}`
                    : 'Sin dorsales asignados'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteMedia(null)}
                disabled={deletingMediaId !== null}
                className="btn-outline-neon flex-1 text-sm py-2 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteMedia(confirmDeleteMedia.albumId, confirmDeleteMedia.media)}
                disabled={deletingMediaId !== null}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {deletingMediaId ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Eliminando…
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Eliminar 🗑️
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
