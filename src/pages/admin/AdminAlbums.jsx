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
  Bot, ScanFace, Save, Trash2, Tag, RefreshCw, Pencil, Palette, Star, Sparkles, Bell,
} from 'lucide-react';
import { uploadToCloudinary } from '../../services/cloudinary';
import { VISUAL_COLOR_PALETTE, normalizeColorList } from '../../constants/visualColors';

const COLOR_MAP = Object.fromEntries(VISUAL_COLOR_PALETTE.map(c => [c.id, c]));

const ATTRIBUTE_FIELDS = [
  { key: 'helmetColors', label: '🪖 Casco',          shortLabel: 'Casco' },
  { key: 'bikeColors',   label: '🚲 Bicicleta',      shortLabel: 'Bici' },
  { key: 'jerseyColors', label: '👕 Remera / Maillot', shortLabel: 'Ropa' },
];

function ColorChipsSelector({ values = [], onToggle, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {VISUAL_COLOR_PALETTE.map(color => {
        const active = values.includes(color.id);
        return (
          <button
            key={color.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(color.id)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold border transition-all disabled:opacity-40 ${
              active
                ? 'bg-neon-green/20 border-neon-green text-white ring-1 ring-neon-green/50 shadow-sm'
                : 'bg-dark-800 border-dark-500 text-gray-300 hover:border-gray-400 hover:text-white'
            }`}
            title={`${active ? 'Quitar' : 'Agregar'} color ${color.label}`}
          >
            <span
              className="w-3 h-3 rounded-full flex-shrink-0 border"
              style={{ backgroundColor: color.hex, borderColor: color.border }}
            />
            <span>{color.label}</span>
          </button>
        );
      })}
    </div>
  );
}

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
  const [uploadFiles, setUploadFiles]   = useState([]);   // { id, file, dorsals, helmetColors, bikeColors, jerseyColors, status, progress, error, result }
  const [uploadAlbumId, setUploadAlbumId] = useState('');
  const [selectedQueueCoverId, setSelectedQueueCoverId] = useState(null); // ID de foto en cola elegida para ser portada
  const [uploading, setUploading]       = useState(false);
  const [uploadSummary, setUploadSummary] = useState(null); // { ok, errors }
  const [expandedAlbum, setExpandedAlbum] = useState(null);
  const [albumMedia, setAlbumMedia]     = useState({});   // { [albumId]: media[] }
  const [mediaDorsalEdits, setMediaDorsalEdits] = useState({}); // { [mediaId]: string }
  const [mediaPriceEdits, setMediaPriceEdits]   = useState({}); // { [mediaId]: number|string }
  const [mediaColorEdits, setMediaColorEdits]   = useState({}); // { [mediaId]: { helmetColors, bikeColors, jerseyColors } }
  const [openColorEditorId, setOpenColorEditorId] = useState(null); // mediaId con panel de colores desplegado
  const [openQueueColorId, setOpenQueueColorId]   = useState(null); // uploadItem.id con panel de colores desplegado
  const [settingCoverMediaId, setSettingCoverMediaId] = useState(null); // mediaId actualizando portada
  const [albumPriceEdits, setAlbumPriceEdits]   = useState({}); // { [albumId]: { pricePhoto, priceVideo } }
  const [savingMediaId, setSavingMediaId]       = useState(null);
  const [savingAlbumPriceId, setSavingAlbumPriceId] = useState(null);
  const [editingAlbumId, setEditingAlbumId]     = useState(null);
  const [albumInfoEdits, setAlbumInfoEdits]     = useState({ title: '', location: '', category: 'Trail Running' });
  const [savingAlbumInfoId, setSavingAlbumInfoId] = useState(null);
  const [deletingAlbumId, setDeletingAlbumId] = useState(null);
  const [confirmDeleteAlbum, setConfirmDeleteAlbum] = useState(null);
  const [deletingMediaId, setDeletingMediaId] = useState(null);
  const [confirmDeleteMedia, setConfirmDeleteMedia] = useState(null);
  const [enableFaceDetection, setEnableFaceDetection] = useState(true);
  const [albumLeads, setAlbumLeads]     = useState({});   // { [albumId]: lead[] }
  const [leadsModalAlbum, setLeadsModalAlbum] = useState(null); // album seleccionado para enviar avisos
  const [copiedLeadsSummary, setCopiedLeadsSummary] = useState(false);
  const dropRef = useRef(null);
  const uploadFilesRef = useRef([]);
  const enableFaceDetectionRef = useRef(true);
  useEffect(() => { uploadFilesRef.current = uploadFiles; }, [uploadFiles]);
  useEffect(() => { enableFaceDetectionRef.current = enableFaceDetection; }, [enableFaceDetection]);

  // Espera brevemente si la foto actual está terminando su análisis IA (máx. 15s) y nunca bloquea la subida
  const waitForAI = async (id, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const it = uploadFilesRef.current.find(f => f.id === id);
      if (!it || it.aiStatus !== 'analyzing') return it;
      await new Promise(r => setTimeout(r, 300));
    }
    return uploadFilesRef.current.find(f => f.id === id);
  };

  // ─── Asignar una foto como portada del álbum en Firestore ───────────────────
  const handleSetAlbumCover = async (albumId, photoUrl, mediaId = null) => {
    if (!albumId || !photoUrl) return;
    if (mediaId) setSettingCoverMediaId(mediaId);
    try {
      const updates = { coverUrl: photoUrl, cover: photoUrl };
      await updateDoc(doc(db, 'albums', albumId), updates);
      setAlbums(prev => prev.map(a => a.id === albumId ? { ...a, ...updates } : a));
    } catch (e) {
      alert('Error al actualizar la portada del álbum: ' + e.message);
    } finally {
      if (mediaId) setSettingCoverMediaId(null);
    }
  };

  // Permite elegir una foto en la cola de subida como portada (si ya se subió, impacta en Firestore al instante)
  const handleSelectQueueCover = async (item) => {
    if (!item || item.file.type.startsWith('video/')) return;
    setSelectedQueueCoverId(prev => (prev === item.id ? null : item.id));
    if (item.status === 'done' && item.result && uploadAlbumId) {
      const photoUrl = item.result.url || item.result.thumb;
      await handleSetAlbumCover(uploadAlbumId, photoUrl);
    }
  };

  // ─── Edición manual de dorsales, atributos visuales y precios en fotos ya subidas ──
  const loadAlbumMedia = async (albumId) => {
    try {
      const snap = await getDocs(query(collection(db, 'media'), where('albumId', '==', albumId)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAlbumMedia(prev => ({ ...prev, [albumId]: list }));
      setMediaDorsalEdits(prev => {
        const next = { ...prev };
        list.forEach(m => { next[m.id] = (m.dorsals || m.bibs || []).join(', '); });
        return next;
      });
      setMediaPriceEdits(prev => {
        const next = { ...prev };
        list.forEach(m => {
          next[m.id] = m.price ?? (m.type === 'video' ? 3000 : 2000);
        });
        return next;
      });
      setMediaColorEdits(prev => {
        const next = { ...prev };
        list.forEach(m => {
          next[m.id] = {
            helmetColors: normalizeColorList(m.helmetColors || []),
            bikeColors:   normalizeColorList(m.bikeColors || []),
            jerseyColors: normalizeColorList(m.jerseyColors || []),
          };
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

  const toggleMediaColorTag = (mediaId, field, colorId) => {
    setMediaColorEdits(prev => {
      const current = prev[mediaId] || { helmetColors: [], bikeColors: [], jerseyColors: [] };
      const list = current[field] || [];
      const nextList = list.includes(colorId)
        ? list.filter(c => c !== colorId)
        : [...list, colorId];
      return {
        ...prev,
        [mediaId]: {
          ...current,
          [field]: nextList,
        },
      };
    });
  };

  const saveMediaItem = async (albumId, mediaId) => {
    setSavingMediaId(mediaId);
    try {
      const dorsals = [...new Set((mediaDorsalEdits[mediaId] || '').split(',').map(d => d.trim()).filter(Boolean))];
      const m = albumMedia[albumId]?.find(item => item.id === mediaId);
      const defaultP = m?.type === 'video' ? 3000 : 2000;
      const rawPrice = mediaPriceEdits[mediaId];
      const price = Number(rawPrice) > 0 ? Number(rawPrice) : (m?.price || defaultP);

      const colorEdit = mediaColorEdits[mediaId] || {
        helmetColors: m?.helmetColors || [],
        bikeColors:   m?.bikeColors || [],
        jerseyColors: m?.jerseyColors || [],
      };
      const helmetColors = normalizeColorList(colorEdit.helmetColors);
      const bikeColors   = normalizeColorList(colorEdit.bikeColors);
      const jerseyColors = normalizeColorList(colorEdit.jerseyColors);

      const updates = {
        dorsals,
        bibs: dorsals,
        price,
        helmetColors,
        bikeColors,
        jerseyColors,
      };

      await updateDoc(doc(db, 'media', mediaId), updates);
      setAlbumMedia(prev => ({
        ...prev,
        [albumId]: (prev[albumId] || []).map(item => item.id === mediaId ? { ...item, ...updates } : item),
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

  const startEditAlbumInfo = (album) => {
    setEditingAlbumId(album.id);
    setAlbumInfoEdits({
      title: album.title || '',
      location: album.location || '',
      category: album.category || 'Trail Running',
    });
  };

  const saveAlbumInfo = async (albumId) => {
    const cleanTitle = (albumInfoEdits.title || '').trim();
    if (!cleanTitle) {
      alert('El nombre del álbum no puede estar vacío.');
      return;
    }
    setSavingAlbumInfoId(albumId);
    try {
      const updates = {
        title: cleanTitle,
        location: (albumInfoEdits.location || '').trim(),
        category: albumInfoEdits.category || 'Trail Running',
      };
      await updateDoc(doc(db, 'albums', albumId), updates);
      setAlbums(prev => prev.map(a => a.id === albumId ? { ...a, ...updates } : a));
      setEditingAlbumId(null);
    } catch (e) {
      alert('Error al guardar el álbum: ' + e.message);
    } finally {
      setSavingAlbumInfoId(null);
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
      setMediaColorEdits(prev => {
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

      // Cargar corredores pre-registrados (album_leads) agrupados por álbum
      try {
        const leadsSnap = await getDocs(collection(db, 'album_leads'));
        const grouped = {};
        leadsSnap.docs.forEach(d => {
          const data = { id: d.id, ...d.data() };
          if (!data.albumId) return;
          if (!grouped[data.albumId]) grouped[data.albumId] = [];
          grouped[data.albumId].push(data);
        });
        setAlbumLeads(grouped);
      } catch (errLeads) {
        console.warn('[AdminAlbums] No se pudieron cargar album_leads:', errLeads);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // ─── Gestión de Leads / Avisos por WhatsApp ─────────────────────────────────
  const buildLeadWhatsAppUrl = (album, lead) => {
    const rawPhone = String(lead?.whatsapp || '').replace(/\D/g, '');
    const phone = rawPhone && !rawPhone.startsWith('54') && rawPhone.length >= 8 && rawPhone.length <= 11
      ? `549${rawPhone.replace(/^0+/, '')}`
      : rawPhone;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ciancia-producciones.onrender.com';
    const albumUrl = `${origin}/album/${album.id}`;
    const greeting = lead?.nombre ? `¡Hola ${lead.nombre}!` : '¡Hola!';
    const text = `${greeting} 📸 Ya subimos las fotos de *${album.title}* en *Ciancia Producciones*.\n\nPodés ver y buscar tus fotos con tu dorsal *#${lead.dorsal}* entrando directo acá:\n${albumUrl}`;
    return phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
  };

  const markLeadNotified = async (albumId, leadId, notified = true) => {
    try {
      await updateDoc(doc(db, 'album_leads', leadId), { notified });
      setAlbumLeads(prev => ({
        ...prev,
        [albumId]: (prev[albumId] || []).map(l => l.id === leadId ? { ...l, notified } : l),
      }));
    } catch (e) {
      console.warn('[AdminAlbums] Error actualizando estado de lead:', e);
    }
  };

  const markAllLeadsNotified = async (albumId) => {
    const list = albumLeads[albumId] || [];
    const pending = list.filter(l => !l.notified);
    if (pending.length === 0) return;
    try {
      await Promise.all(pending.map(l => updateDoc(doc(db, 'album_leads', l.id), { notified: true })));
      setAlbumLeads(prev => ({
        ...prev,
        [albumId]: (prev[albumId] || []).map(l => ({ ...l, notified: true })),
      }));
    } catch (e) {
      alert('Error al marcar avisos: ' + e.message);
    }
  };

  const handleDeleteLead = async (albumId, leadId) => {
    try {
      await deleteDoc(doc(db, 'album_leads', leadId));
      setAlbumLeads(prev => ({
        ...prev,
        [albumId]: (prev[albumId] || []).filter(l => l.id !== leadId),
      }));
    } catch (e) {
      alert('Error al eliminar pre-registro: ' + e.message);
    }
  };

  const handleSendNextPendingWhatsApp = async (album) => {
    const list = albumLeads[album.id] || [];
    const nextLead = list.find(l => !l.notified && l.whatsapp) || list.find(l => l.whatsapp);
    if (!nextLead) {
      alert('No hay corredores con número de WhatsApp pendiente en este álbum.');
      return;
    }
    const url = buildLeadWhatsAppUrl(album, nextLead);
    window.open(url, '_blank', 'noopener,noreferrer');
    await markLeadNotified(album.id, nextLead.id, true);
  };

  const handleCopyLeadsSummary = async (album) => {
    const list = albumLeads[album.id] || [];
    if (list.length === 0) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://ciancia-producciones.onrender.com';
    const lines = list.map(l =>
      `Dorsal #${l.dorsal}${l.nombre ? ` (${l.nombre})` : ''} - WhatsApp: ${l.whatsapp || '—'}${l.email ? ` | Email: ${l.email}` : ''} -> ${origin}/album/${album.id}`
    );
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedLeadsSummary(true);
      setTimeout(() => setCopiedLeadsSummary(false), 2200);
    } catch {
      // noop
    }
  };

  // ─── Crear álbum ────────────────────────────────────────────────────────────
  const handleCreateAlbum = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const pricePhoto = newAlbum.pricePhoto ? Number(newAlbum.pricePhoto) : 2000;
      const priceVideo = newAlbum.priceVideo ? Number(newAlbum.priceVideo) : 3000;
      const cleanCover = (newAlbum.coverUrl || '').trim();
      const albumData = {
        ...newAlbum,
        coverUrl: cleanCover,
        cover: cleanCover,
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
  const runAIOnItem = async (it) => {
    try {
      const { analyzeImageFile } = await import('../../services/aiService');
      const {
        dorsals,
        helmetColors,
        bikeColors,
        jerseyColors,
        hasVisibleFace,
        faceSkipped,
        faceDescriptors,
        cancelled,
      } = await analyzeImageFile(it.file, {
        shouldCancel: () => !uploadFilesRef.current.some(f => f.id === it.id),
        enableFaceDetection: enableFaceDetectionRef.current,
      });
      if (cancelled) return;
      setUploadFiles(prev => prev.map(f => {
        if (f.id !== it.id) return f;
        return {
          ...f,
          aiStatus: 'done',
          aiDorsals: dorsals,
          hasVisibleFace: typeof hasVisibleFace === 'boolean' ? hasVisibleFace : true,
          faceSkipped: Boolean(faceSkipped),
          faceDescriptors: faceSkipped ? [] : (faceDescriptors?.length ? faceDescriptors : f.faceDescriptors),
          // Sugerencia editable: solo si el admin no escribió nada a mano
          dorsals: !f.dorsalsTouched && !f.dorsals.trim() ? dorsals.join(', ') : f.dorsals,
          helmetColors: f.colorsTouched ? f.helmetColors : normalizeColorList(helmetColors),
          bikeColors:   f.colorsTouched ? f.bikeColors   : normalizeColorList(bikeColors),
          jerseyColors: f.colorsTouched ? f.jerseyColors : normalizeColorList(jerseyColors),
        };
      }));
    } catch (err) {
      console.warn('[AdminAlbums] IA falló', err);
      patchFile(it.id, { aiStatus: 'error' });
    }
  };

  const addFiles = (rawFiles) => {
    const accepted = rawFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    const items = accepted.map(f => ({
      id:              Math.random().toString(36).slice(2),
      file:            f,
      previewUrl:      f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      dorsals:         '',
      dorsalsTouched:  false,       // true si el admin editó el input a mano
      colorsTouched:   false,       // true si el admin retocó colores manualmente
      helmetColors:    [],
      bikeColors:      [],
      jerseyColors:    [],
      hasVisibleFace:  true,
      faceSkipped:     false,
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

    // Análisis IA automático en segundo plano (import 100% dinámico, cola secuencial 3s)
    items.filter(it => it.aiStatus === 'analyzing').forEach(runAIOnItem);
  };

  const retryAIForItem = (item) => {
    if (!item || item.aiStatus === 'analyzing') return;
    patchFile(item.id, { aiStatus: 'analyzing' });
    runAIOnItem(item);
  };

  const retryAllMissingDorsals = () => {
    const targets = uploadFiles.filter(
      f => f.file.type.startsWith('image/') && f.aiStatus !== 'analyzing' && f.aiDorsals.length === 0 && !f.dorsals.trim()
    );
    targets.forEach(retryAIForItem);
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

  const toggleQueueItemColor = (id, field, colorId) =>
    setUploadFiles(prev => prev.map(f => {
      if (f.id !== id) return f;
      const current = f[field] || [];
      const nextList = current.includes(colorId)
        ? current.filter(c => c !== colorId)
        : [...current, colorId];
      return {
        ...f,
        [field]: nextList,
        colorsTouched: true,
      };
    }));

  const removeFile = (id) => {
    if (selectedQueueCoverId === id) setSelectedQueueCoverId(null);
    setUploadFiles(prev => {
      const target = prev.find(f => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter(f => f.id !== id);
    });
  };

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
      const helmetColors = normalizeColorList(item.helmetColors || []);
      const bikeColors   = normalizeColorList(item.bikeColors || []);
      const jerseyColors = normalizeColorList(item.jerseyColors || []);

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

        // 2) Guardado en Firestore (incluyendo dorsales y atributos visuales de ciclismo/running)
        await addDoc(collection(db, 'media'), {
          type:         isVideo ? 'video' : 'photo',
          fileName:     item.file.name,
          url:          result.url,         // URL HD optimizada (f_auto,q_auto)
          thumb:        result.thumb,       // Thumbnail 400px
          publicId:     result.publicId,    // Para futuras transformaciones
          duration:     result.duration || null,
          dorsals:      dorsalList,
          bibs:         dorsalList,
          aiDorsals:    item.aiDorsals || [],
          helmetColors,
          bikeColors,
          jerseyColors,
          hasVisibleFace: item.hasVisibleFace ?? true,
          // Array de objetos planos { vector: number[] } — Firestore no admite number[][]
          faceDescriptors: (item.faceDescriptors || []).map(d =>
            Array.isArray(d) ? { vector: Array.from(d) } : { vector: Array.from(d.vector) }
          ),
          facesCount:   (item.faceDescriptors || []).length,
          albumId:      uploadAlbumId,
          albumSlug:    album?.slug  || '',
          albumTitle:   album?.title || '',
          price:        finalPrice,
          approved:     true,
          createdAt:    Timestamp.now(),
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

    // 3) Actualizar contador y portada del álbum en Firestore y reflejarlo de inmediato en el estado
    if (ok > 0) {
      const albumUpdates = {
        totalMedia: (album?.totalMedia || 0) + ok,
      };

      // Si el admin marcó una foto específica en la cola como portada, o si el álbum no tiene portada definida aún (`coverUrl` / `cover` vacío)
      const explicitQueueCover = selectedQueueCoverId
        ? uploadFilesRef.current.find(f => f.id === selectedQueueCoverId && f.status === 'done' && !f.file.type.startsWith('video/'))
        : null;
      const firstDonePhoto = uploadFilesRef.current.find(f => f.status === 'done' && !f.file.type.startsWith('video/'))
        || uploadFilesRef.current.find(f => f.status === 'done');

      const hasExistingCover = Boolean((album?.coverUrl && album.coverUrl.trim()) || (album?.cover && album.cover.trim()));

      if (explicitQueueCover?.result) {
        const chosenUrl = explicitQueueCover.result.url || explicitQueueCover.result.thumb;
        if (chosenUrl) {
          albumUpdates.coverUrl = chosenUrl;
          albumUpdates.cover    = chosenUrl;
        }
      } else if (!hasExistingCover && firstDonePhoto?.result) {
        const autoCoverUrl = firstDonePhoto.result.url || firstDonePhoto.result.thumb;
        if (autoCoverUrl) {
          albumUpdates.coverUrl = autoCoverUrl;
          albumUpdates.cover    = autoCoverUrl;
        }
      }

      await updateDoc(doc(db, 'albums', uploadAlbumId), albumUpdates);
      // Actualizar contador y portada del álbum en el estado local de forma fluida
      setAlbums(prev => prev.map(a => a.id === uploadAlbumId ? { ...a, ...albumUpdates } : a));
    }

    setUploadSummary({ ok, errors });
    setUploading(false);
    setSelectedQueueCoverId(null);

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

  const clearAll   = () => {
    uploadFiles.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    setUploadFiles([]);
    setSelectedQueueCoverId(null);
    setUploadSummary(null);
  };
  const retryErrors = () =>
    setUploadFiles(prev => prev.map(f => f.status === 'error' ? { ...f, status: 'idle', progress: 0, error: null } : f));

  const hasErrors   = uploadFiles.some(f => f.status === 'error');
  const idleCount   = uploadFiles.filter(f => f.status === 'idle').length;
  const doneCount   = uploadFiles.filter(f => f.status === 'done').length;
  const totalCount  = uploadFiles.length;
  const aiAnalyzingCount = uploadFiles.filter(f => f.aiStatus === 'analyzing').length;
  const missingDorsalsCount = uploadFiles.filter(
    f => f.file.type.startsWith('image/') && f.aiStatus !== 'analyzing' && f.aiDorsals.length === 0 && !f.dorsals.trim()
  ).length;

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
                <label className="text-sm text-gray-400 mb-1 block">Portada del álbum</label>
                <div className="flex items-center gap-2.5 rounded-xl bg-neon-green/10 border border-neon-green/30 px-3.5 py-2.5 text-xs text-gray-200 leading-snug">
                  <Sparkles className="w-4 h-4 text-neon-green flex-shrink-0" />
                  <span>
                    La portada se asignará automáticamente con la primera foto subida, o podés elegir cualquiera desde los detalles del álbum.
                  </span>
                </div>
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
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-bold text-white text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-neon-green" /> Carga masiva — Cloudinary + IA Unificada
            </h2>
            {/* Badge de Cloudinary + IA */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs bg-neon-green/10 border border-neon-green/30 text-neon-green px-2.5 py-1 rounded-full font-medium">
                🤖 Dorsales + Casco/Bici/Ropa (Cola 3s)
              </span>
              <span className="text-xs bg-blue-500/15 border border-blue-500/30 text-blue-300 px-2 py-1 rounded-full font-medium">
                ☁ khzko7rr · ciancia_uploads
              </span>
            </div>
          </div>

          {/* Selector de álbum + Toggle rápido de detección de rostros */}
          <div className="mb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="flex-1 max-w-md">
              <label className="text-sm text-gray-400 mb-1 block">Álbum destino</label>
              <select value={uploadAlbumId} onChange={e => setUploadAlbumId(e.target.value)} className="input-dark w-full" disabled={uploading}>
                <option value="">Seleccioná un álbum...</option>
                {albums.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>

            <label
              className={`inline-flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold cursor-pointer select-none transition-all ${
                enableFaceDetection
                  ? 'bg-neon-green/10 border-neon-green/40 text-white'
                  : 'bg-dark-800 border-dark-500 text-gray-400'
              }`}
              title="Si la foto tiene casco y lentes o rostro cubierto, la IA omite el reconocimiento facial automáticamente. También podés destildarlo para álbumes 100% de ciclismo."
            >
              <input
                type="checkbox"
                checked={enableFaceDetection}
                onChange={e => setEnableFaceDetection(e.target.checked)}
                className="w-4 h-4 accent-[#06b6d4] rounded cursor-pointer"
              />
              <ScanFace className={`w-4 h-4 ${enableFaceDetection ? 'text-neon-green' : 'text-gray-500'}`} />
              <span>Detectar rostros (solo caras visibles)</span>
            </label>
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
            <p className="text-gray-600 text-sm mt-1">JPG, PNG, WEBP, MP4, MOV, AVI — La IA detecta dorsales, color de casco, bici y ropa automáticamente</p>
            <input id="cloudFileInput" type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" disabled={uploading} />
          </div>

          {/* ── Lista de archivos con progreso ──────────────────────────────── */}
          {uploadFiles.length > 0 && (
            <div className="mt-5 space-y-3">

              {uploadFiles.map((item, idx) => {
                const isVideo = item.file.type.startsWith('video/');
                const sizeMB  = (item.file.size / 1024 / 1024).toFixed(1);
                const totalColorsCount = (item.helmetColors?.length || 0) + (item.bikeColors?.length || 0) + (item.jerseyColors?.length || 0);
                const isColorPanelOpen = openQueueColorId === item.id;
                const targetAlbum = albums.find(a => a.id === uploadAlbumId);
                const albumHasCover = Boolean((targetAlbum?.coverUrl && targetAlbum.coverUrl.trim()) || (targetAlbum?.cover && targetAlbum.cover.trim()));
                const firstImageIdx = uploadFiles.findIndex(f => !f.file.type.startsWith('video/'));
                const isSelectedQueueCover = !isVideo && (
                  selectedQueueCoverId === item.id ||
                  (!selectedQueueCoverId && !albumHasCover && idx === firstImageIdx)
                );

                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-4 transition-all space-y-3 ${
                      isSelectedQueueCover
                        ? 'bg-cyan-500/10 border-2 border-cyan-500 shadow-lg shadow-cyan-500/10'
                        : item.status === 'done'
                          ? 'bg-cyan-900/15 border-cyan-500/30'
                          : item.status === 'error'
                            ? 'bg-red-900/15 border-red-500/30'
                            : 'bg-dark-700 border-dark-500'
                    }`}
                  >
                    {/* Fila 1: Miniatura/Ícono, Nombre del archivo, tamaño, botón portada y botón eliminar */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {item.previewUrl ? (
                          <img
                            src={item.previewUrl}
                            alt=""
                            className={`w-11 h-11 rounded-xl object-cover border flex-shrink-0 bg-dark-800 ${
                              isSelectedQueueCover ? 'border-neon-green ring-2 ring-neon-green/40' : 'border-dark-500'
                            }`}
                          />
                        ) : (
                          <div className="flex-shrink-0 p-2.5 bg-dark-600 rounded-xl">
                            {isVideo
                              ? <Video  className="w-5 h-5 text-neon-green" />
                              : <Camera className="w-5 h-5 text-blue-400"   />
                            }
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-white text-sm font-semibold truncate leading-tight">{item.file.name}</p>
                            {isSelectedQueueCover && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-neon-green text-black shadow-sm">
                                ★ Portada actual
                              </span>
                            )}
                          </div>
                          <p className="text-gray-400 text-xs mt-0.5">{sizeMB} MB · {isVideo ? 'Video' : 'Imagen'}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isVideo && (
                          <button
                            type="button"
                            onClick={() => handleSelectQueueCover(item)}
                            disabled={item.status === 'uploading'}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-40 ${
                              isSelectedQueueCover
                                ? 'bg-neon-green text-black border-neon-green shadow-sm'
                                : 'bg-dark-800 border-dark-500 text-gray-300 hover:border-neon-green/60 hover:text-neon-green'
                            }`}
                            title="Definir esta foto como portada del álbum"
                          >
                            <Star className={`w-3.5 h-3.5 ${isSelectedQueueCover ? 'fill-current' : ''}`} />
                            <span>{isSelectedQueueCover ? '★ Portada actual' : '⭐ Usar como portada'}</span>
                          </button>
                        )}

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
                    </div>

                    {/* Barra de progreso de subida a Cloudinary */}
                    {(item.status === 'uploading' || item.status === 'done') && (
                      <div className="w-full h-1.5 rounded-full bg-dark-500 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-200 ${
                            item.status === 'done' ? 'bg-cyan-400' : 'bg-cyan-500'
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
                          <span className="font-semibold tracking-wide">Analizando dorsales, casco, bici, ropa y rostros con IA...</span>
                        </div>
                      )}

                      {item.aiStatus === 'done' && (
                        <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-neon-green bg-neon-green/10 border border-neon-green/30 rounded-xl px-3.5 py-2 shadow-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <Bot className="w-4 h-4 flex-shrink-0" />
                            <span className="font-bold">{item.aiDorsals.length} dorsal{item.aiDorsals.length !== 1 ? 'es' : ''}</span>
                            <span className="opacity-40">·</span>
                            {item.faceSkipped || item.hasVisibleFace === false ? (
                              <span className="font-semibold text-cyan-300">🚴 Rostro cubierto (Selfie omitido)</span>
                            ) : (
                              <>
                                <ScanFace className="w-4 h-4 flex-shrink-0" />
                                <span className="font-semibold">{item.faceDescriptors.length} rostro{item.faceDescriptors.length !== 1 ? 's' : ''}</span>
                              </>
                            )}
                            <span className="opacity-40">·</span>
                            <Palette className="w-4 h-4 flex-shrink-0" />
                            <span className="font-semibold">{totalColorsCount} tag{totalColorsCount !== 1 ? 's' : ''} de color</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {item.aiDorsals.length > 0 && (
                              <span className="text-[11px] text-gray-300 font-mono hidden xs:inline">
                                [{item.aiDorsals.join(', ')}]
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => retryAIForItem(item)}
                              className="inline-flex items-center gap-1 text-[11px] text-yellow-300 hover:text-white bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-500/30 px-2 py-0.5 rounded-lg transition-colors"
                              title="Volver a analizar dorsales y colores con IA"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Reintentar IA
                            </button>
                          </div>
                        </div>
                      )}

                      {item.aiStatus === 'error' && (
                        <div className="w-full flex items-center gap-2 text-xs text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-xl px-3.5 py-2">
                          <AlertCircle className="w-4 h-4 text-orange-400 flex-shrink-0" />
                          <span>Sin IA — podés ingresar dorsales y colores manualmente</span>
                        </div>
                      )}

                      {item.status === 'uploading' && (
                        <p className="text-xs text-neon-green animate-pulse font-medium">Subiendo a Cloudinary… {item.progress}%</p>
                      )}

                      {item.status === 'done' && (
                        <div className="text-xs text-cyan-400 flex items-center gap-1.5 font-medium">
                          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                          <span>Subido correctamente</span>
                          {item.result?.publicId && (
                            <a href={item.result.url} target="_blank" rel="noreferrer"
                              className="ml-2 text-sky-400 hover:underline" onClick={e => e.stopPropagation()}>
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

                    {/* Fila 3: Input de dorsales + Botón de Atributos Visuales (Casco / Bici / Ropa) */}
                    <div className="w-full pt-0.5 space-y-2">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex items-center flex-1">
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

                        {!isVideo && (
                          <button
                            type="button"
                            onClick={() => setOpenQueueColorId(isColorPanelOpen ? null : item.id)}
                            className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all whitespace-nowrap ${
                              isColorPanelOpen || totalColorsCount > 0
                                ? 'bg-neon-green/15 border-neon-green/50 text-neon-green'
                                : 'bg-dark-800 border-dark-500 text-gray-300 hover:text-white hover:border-gray-400'
                            }`}
                          >
                            <Palette className="w-4 h-4" />
                            <span>🚴 Colores (Casco / Bici / Ropa)</span>
                            {totalColorsCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded-full bg-neon-green text-black text-[10px] font-black">
                                {totalColorsCount}
                              </span>
                            )}
                            {isColorPanelOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>

                      {/* Resumen rápido de chips de colores detectados/seleccionados */}
                      {!isVideo && totalColorsCount > 0 && !isColorPanelOpen && (
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-300 pl-1">
                          {ATTRIBUTE_FIELDS.map(({ key, shortLabel }) => {
                            const list = item[key] || [];
                            if (list.length === 0) return null;
                            return (
                              <span key={key} className="inline-flex items-center gap-1 bg-dark-800 border border-dark-500 px-2 py-0.5 rounded-full">
                                <strong className="text-gray-400">{shortLabel}:</strong>
                                {list.map(cid => {
                                  const c = COLOR_MAP[cid];
                                  if (!c) return null;
                                  return (
                                    <span key={cid} className="inline-flex items-center gap-1 text-white">
                                      <span className="w-2.5 h-2.5 rounded-full border" style={{ backgroundColor: c.hex, borderColor: c.border }} />
                                      {c.label}
                                    </span>
                                  );
                                })}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Panel desplegable para editar colores en la cola de subida */}
                      {!isVideo && isColorPanelOpen && (
                        <div className="bg-dark-800/90 border border-dark-500 rounded-xl p-3.5 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Palette className="w-3.5 h-3.5 text-neon-green" />
                              Editar atributos visuales de la foto (clic para activar/desactivar)
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenQueueColorId(null)}
                              className="text-xs text-gray-400 hover:text-white"
                            >
                              Cerrar
                            </button>
                          </div>
                          {ATTRIBUTE_FIELDS.map(({ key, label }) => (
                            <div key={key} className="space-y-1">
                              <span className="text-xs font-semibold text-gray-300 block">{label}</span>
                              <ColorChipsSelector
                                values={item[key] || []}
                                onToggle={(colorId) => toggleQueueItemColor(item.id, key, colorId)}
                                disabled={item.status === 'uploading' || item.status === 'done'}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {item.aiStatus === 'done' && !item.dorsalsTouched && item.dorsals && (
                        <p className="text-[11px] text-neon-green/80 mt-1 pl-1">✓ Dorsales y colores detectados automáticamente por IA (editables)</p>
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

                {missingDorsalsCount > 0 && !uploading && aiAnalyzingCount === 0 && (
                  <button
                    type="button"
                    onClick={retryAllMissingDorsals}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-yellow-500/15 hover:bg-yellow-500/25 border border-yellow-500/40 text-yellow-300 text-xs font-bold transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reintentar IA en {missingDorsalsCount} sin dorsal
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
                    ? 'bg-cyan-900/20 border-cyan-500/30 text-cyan-300'
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
            {albums.map(album => {
              const currentAlbumCover = album.coverUrl || album.cover || '';
              const leadsForAlbum = albumLeads[album.id] || [];
              const pendingLeadsCount = leadsForAlbum.filter(l => !l.notified).length;
              return (
                <div key={album.id} className="card-dark border border-dark-500">
                  <div className="p-4 flex flex-wrap sm:flex-nowrap items-center gap-4">
                    <img
                      src={currentAlbumCover || 'https://placehold.co/80x60/1a1a1a/06b6d4?text=Auto+Portada'}
                      alt={album.title}
                      className="w-16 h-12 object-cover rounded-lg flex-shrink-0 border border-dark-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-white truncate">{album.title}</h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          leadsForAlbum.length > 0
                            ? 'bg-neon-green/15 border-neon-green/40 text-neon-green'
                            : 'bg-dark-700 border-dark-600 text-gray-400'
                        }`}>
                          <Bell className="w-3 h-3" />
                          <span>
                            {leadsForAlbum.length} {leadsForAlbum.length === 1 ? 'corredor esperando aviso' : 'corredores esperando aviso'}
                          </span>
                        </span>
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5">{album.category} · {album.location} · {album.totalMedia || 0} archivos</p>
                    </div>
                    <div className="flex items-center flex-wrap gap-2">
                      <Link
                        to={`/album/${album.id}`}
                        className="p-2 text-gray-400 hover:text-neon-green transition-colors"
                        title="Ver álbum en la tienda"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>

                      <button
                        type="button"
                        onClick={() => setLeadsModalAlbum(album)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                          pendingLeadsCount > 0
                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/25'
                            : 'bg-dark-700 border-dark-500 text-gray-200 hover:text-neon-green hover:border-neon-green/50'
                        }`}
                        title="Ver corredores pre-registrados y enviar avisos por WhatsApp"
                      >
                        <span>📢 Enviar avisos por WhatsApp</span>
                        {leadsForAlbum.length > 0 && (
                          <span className="px-1.5 py-0.2 rounded-full bg-neon-green text-black text-[10px] font-black">
                            {leadsForAlbum.length}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => editingAlbumId === album.id ? setEditingAlbumId(null) : startEditAlbumInfo(album)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-200 bg-dark-700 border border-dark-500 hover:text-neon-green hover:border-neon-green/50 transition-colors"
                        title="Editar nombre y datos del álbum"
                      >
                        <Pencil className="w-3.5 h-3.5 text-neon-green" />
                        <span>Editar</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleAlbum(album.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-200 bg-dark-700 border border-dark-500 hover:text-neon-green hover:border-neon-green/50 transition-colors"
                      >
                        {expandedAlbum === album.id ? (
                          <ChevronUp className="w-3.5 h-3.5 text-neon-green" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-neon-green" />
                        )}
                        <span>Detalles</span>
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

                  {/* ── Formulario rápido para editar nombre, ubicación y categoría del álbum ── */}
                  {editingAlbumId === album.id && (
                    <div className="border-t border-dark-600 bg-dark-800/80 p-4 space-y-3">
                      <p className="text-xs font-bold text-neon-green flex items-center gap-1.5">
                        <Pencil className="w-3.5 h-3.5" /> Editar nombre y datos del álbum
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 mb-1 block">Nombre del álbum *</label>
                          <input
                            type="text"
                            value={albumInfoEdits.title}
                            onChange={e => setAlbumInfoEdits(p => ({ ...p, title: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveAlbumInfo(album.id); }}
                            className="input-dark text-sm py-1.5"
                            placeholder="Nombre del álbum"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 mb-1 block">Ubicación</label>
                          <input
                            type="text"
                            value={albumInfoEdits.location}
                            onChange={e => setAlbumInfoEdits(p => ({ ...p, location: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveAlbumInfo(album.id); }}
                            className="input-dark text-sm py-1.5"
                            placeholder="Ej: Villa Ventana"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 mb-1 block">Categoría</label>
                          <select
                            value={albumInfoEdits.category}
                            onChange={e => setAlbumInfoEdits(p => ({ ...p, category: e.target.value }))}
                            className="input-dark text-sm py-1.5"
                          >
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => saveAlbumInfo(album.id)}
                          disabled={savingAlbumInfoId === album.id}
                          className="btn-neon text-xs py-1.5 px-4 flex items-center gap-1.5"
                        >
                          {savingAlbumInfoId === album.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          Guardar cambios
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAlbumId(null)}
                          className="btn-outline-neon text-xs py-1.5 px-3"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

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

                      {/* ── Edición manual de portada, dorsales, atributos visuales y precios ── */}
                      <div className="pt-3 mt-3 border-t border-dark-600">
                        <p className="text-white font-semibold mb-2 flex items-center gap-2 flex-wrap">
                          <Bot className="w-4 h-4 text-neon-green" /> Portada, Dorsales, Atributos Visuales y Precios por archivo
                          <span className="text-xs text-gray-500 font-normal">(elegí la foto de portada con ⭐, corregí dorsales o retocá colores)</span>
                        </p>
                        {!albumMedia[album.id] ? (
                          <p className="text-neon-green animate-pulse text-xs">Cargando archivos…</p>
                        ) : albumMedia[album.id].length === 0 ? (
                          <p className="text-xs text-gray-500">Este álbum todavía no tiene archivos.</p>
                        ) : (
                          <div className="grid grid-cols-1 gap-2.5 max-h-[520px] overflow-y-auto pr-1">
                            {albumMedia[album.id].map(m => {
                              const originalDorsals = (m.dorsals || m.bibs || []).join(', ');
                              const originalPrice = m.price !== undefined && m.price !== null ? String(m.price) : (m.type === 'video' ? '3000' : '2000');
                              const currentDorsals = mediaDorsalEdits[m.id] ?? originalDorsals;
                              const currentPrice = mediaPriceEdits[m.id] ?? originalPrice;

                              const origHelmet = normalizeColorList(m.helmetColors || []);
                              const origBike   = normalizeColorList(m.bikeColors || []);
                              const origJersey = normalizeColorList(m.jerseyColors || []);

                              const currentColors = mediaColorEdits[m.id] || {
                                helmetColors: origHelmet,
                                bikeColors:   origBike,
                                jerseyColors: origJersey,
                              };

                              const colorsChanged =
                                currentColors.helmetColors.join(',') !== origHelmet.join(',') ||
                                currentColors.bikeColors.join(',')   !== origBike.join(',') ||
                                currentColors.jerseyColors.join(',') !== origJersey.join(',');

                              const dirty =
                                currentDorsals !== originalDorsals ||
                                String(currentPrice) !== String(originalPrice) ||
                                colorsChanged;

                              const totalColors =
                                currentColors.helmetColors.length +
                                currentColors.bikeColors.length +
                                currentColors.jerseyColors.length;

                              const isColorOpen = openColorEditorId === m.id;
                              const isCurrentCover = Boolean(
                                currentAlbumCover &&
                                (currentAlbumCover === m.url || currentAlbumCover === m.thumb)
                              );

                              return (
                                <div
                                  key={m.id}
                                  className={`rounded-xl p-2.5 transition-all space-y-2 ${
                                    isCurrentCover
                                      ? 'bg-neon-green/10 border-2 border-neon-green shadow-md shadow-neon-green/10'
                                      : 'bg-dark-700 border border-dark-500'
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="relative flex-shrink-0">
                                      <img
                                        src={m.thumb || m.url}
                                        alt={m.fileName}
                                        className={`w-14 h-10 object-cover rounded ${
                                          isCurrentCover ? 'ring-2 ring-neon-green' : ''
                                        }`}
                                        draggable={false}
                                      />
                                    </div>
                                    <div className="flex-1 min-w-[140px]">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="text-xs text-gray-200 font-semibold truncate">{m.fileName}</p>
                                        {isCurrentCover && (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-neon-green text-black shadow-sm">
                                            ★ Portada actual
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-gray-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                                        <span className="inline-flex items-center gap-1">
                                          {m.type === 'video' ? <Video className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                                          {m.type === 'photo' && <><ScanFace className="w-3 h-3 ml-1" /> {m.facesCount ?? (m.faceDescriptors?.length || 0)}</>}
                                        </span>
                                        {totalColors > 0 && (
                                          <span className="inline-flex items-center gap-1 text-gray-300">
                                            ·
                                            {[...new Set([
                                              ...currentColors.helmetColors,
                                              ...currentColors.bikeColors,
                                              ...currentColors.jerseyColors,
                                            ])].map(cid => {
                                              const c = COLOR_MAP[cid];
                                              if (!c) return null;
                                              return (
                                                <span
                                                  key={cid}
                                                  title={c.label}
                                                  className="w-2.5 h-2.5 rounded-full border inline-block"
                                                  style={{ backgroundColor: c.hex, borderColor: c.border }}
                                                />
                                              );
                                            })}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Botón "⭐ Usar como portada" / "★ Portada actual" */}
                                    {m.type !== 'video' && (
                                      <button
                                        type="button"
                                        disabled={isCurrentCover || settingCoverMediaId === m.id}
                                        onClick={() => handleSetAlbumCover(album.id, m.url || m.thumb, m.id)}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                                          isCurrentCover
                                            ? 'bg-neon-green text-black border-neon-green cursor-default shadow-sm'
                                            : 'bg-dark-800 border-dark-600 text-gray-300 hover:border-neon-green hover:text-neon-green'
                                        }`}
                                        title={isCurrentCover ? 'Esta foto ya es la portada actual del álbum' : 'Fijar esta foto como portada del álbum'}
                                      >
                                        {settingCoverMediaId === m.id ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Star className={`w-3.5 h-3.5 ${isCurrentCover ? 'fill-current' : ''}`} />
                                        )}
                                        <span>{isCurrentCover ? '★ Portada actual' : '⭐ Usar como portada'}</span>
                                      </button>
                                    )}

                                    <div className="relative flex items-center" title="Dorsales separados por coma">
                                      <input
                                        value={currentDorsals}
                                        onChange={e => setMediaDorsalEdits(prev => ({ ...prev, [m.id]: e.target.value }))}
                                        placeholder="Sin dorsales"
                                        className="input-dark text-xs py-1 pr-6 w-28 font-mono"
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

                                    {m.type === 'photo' && (
                                      <button
                                        type="button"
                                        onClick={() => setOpenColorEditorId(isColorOpen ? null : m.id)}
                                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                                          isColorOpen || totalColors > 0
                                            ? 'bg-neon-green/15 border-neon-green/50 text-neon-green'
                                            : 'bg-dark-800 border-dark-600 text-gray-300 hover:text-white'
                                        }`}
                                        title="Editar colores de Casco, Bicicleta y Remera"
                                      >
                                        <Palette className="w-3.5 h-3.5" />
                                        <span>Colores ({totalColors})</span>
                                      </button>
                                    )}

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
                                      title="Guardar cambios (dorsales, colores y precio)"
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

                                  {/* Editor desplegable de colores para esta foto ya subida */}
                                  {isColorOpen && (
                                    <div className="bg-dark-800/90 border border-dark-600 rounded-xl p-3 space-y-2.5">
                                      {ATTRIBUTE_FIELDS.map(({ key, label }) => (
                                        <div key={key} className="space-y-1">
                                          <span className="text-[11px] font-bold text-gray-300 block">{label}</span>
                                          <ColorChipsSelector
                                            values={currentColors[key] || []}
                                            onToggle={(colorId) => toggleMediaColorTag(m.id, key, colorId)}
                                            disabled={savingMediaId === m.id}
                                          />
                                        </div>
                                      ))}
                                      <div className="flex items-center justify-end gap-2 pt-1">
                                        <button
                                          type="button"
                                          onClick={() => setOpenColorEditorId(null)}
                                          className="text-xs text-gray-400 hover:text-white px-2 py-1"
                                        >
                                          Cerrar
                                        </button>
                                        <button
                                          type="button"
                                          disabled={!dirty || savingMediaId === m.id}
                                          onClick={() => saveMediaItem(album.id, m.id)}
                                          className="btn-neon text-xs py-1 px-3 inline-flex items-center gap-1.5 disabled:opacity-40"
                                        >
                                          {savingMediaId === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                          Guardar colores
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal de Gestión de Leads y Envío de Avisos por WhatsApp ── */}
      {leadsModalAlbum && (() => {
        const list = albumLeads[leadsModalAlbum.id] || [];
        const pendingList = list.filter(l => !l.notified);
        const notifiedCount = list.length - pendingList.length;

        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
            onClick={() => setLeadsModalAlbum(null)}
          >
            <div
              className="bg-dark-800 border border-neon-green/40 rounded-2xl p-6 max-w-2xl w-full shadow-2xl relative space-y-4 max-h-[90vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-dark-600 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-neon-green/15 border border-neon-green/40 flex items-center justify-center flex-shrink-0">
                    <Bell className="w-5 h-5 text-neon-green" />
                  </div>
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-neon-green">
                      Pre-registro de Corredores (Lead Capture)
                    </span>
                    <h3 className="font-black text-white text-lg leading-tight">
                      {leadsModalAlbum.title}
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {list.length} {list.length === 1 ? 'corredor registrado' : 'corredores registrados'} ·{' '}
                      <span className="text-yellow-300 font-semibold">{pendingList.length} pendiente{pendingList.length !== 1 ? 's' : ''}</span> ·{' '}
                      <span className="text-cyan-400 font-semibold">{notifiedCount} avisado{notifiedCount !== 1 ? 's' : ''}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLeadsModalAlbum(null)}
                  className="text-gray-400 hover:text-white p-1.5 rounded-lg bg-dark-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {list.length === 0 ? (
                <div className="py-12 text-center text-gray-400 space-y-2">
                  <Bell className="w-10 h-10 mx-auto opacity-25" />
                  <p className="text-sm font-semibold text-white">Todavía no hay corredores pre-registrados en este álbum</p>
                  <p className="text-xs text-gray-400 max-w-md mx-auto">
                    Cuando los deportistas entren al álbum y toquen el botón <strong>&ldquo;🔔 Avisame cuando suban mis fotos&rdquo;</strong>, aparecerán listados acá con su dorsal y WhatsApp listos para enviarles el aviso.
                  </p>
                </div>
              ) : (
                <>
                  {/* Barra de acciones masivas */}
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-dark-700/80 border border-dark-600 rounded-xl p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSendNextPendingWhatsApp(leadsModalAlbum)}
                        disabled={pendingList.length === 0}
                        className="btn-neon text-xs py-2 px-3.5 inline-flex items-center gap-1.5 disabled:opacity-40"
                      >
                        <span>🚀 Enviar al siguiente pendiente ({pendingList.length})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyLeadsSummary(leadsModalAlbum)}
                        className="btn-outline-neon text-xs py-2 px-3 inline-flex items-center gap-1.5"
                      >
                        <span>{copiedLeadsSummary ? '✅ ¡Lista copiada!' : '📋 Copiar lista completa'}</span>
                      </button>
                    </div>

                    {pendingList.length > 0 && (
                      <button
                        type="button"
                        onClick={() => markAllLeadsNotified(leadsModalAlbum.id)}
                        className="text-xs text-gray-300 hover:text-neon-green font-semibold px-2 py-1"
                      >
                        ✓ Marcar todos como avisados
                      </button>
                    )}
                  </div>

                  {/* Lista de corredores */}
                  <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                    {list.map(lead => {
                      const waUrl = buildLeadWhatsAppUrl(leadsModalAlbum, lead);
                      return (
                        <div
                          key={lead.id}
                          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 border transition-colors ${
                            lead.notified
                              ? 'bg-dark-700/50 border-dark-600 opacity-80'
                              : 'bg-dark-700 border-neon-green/30'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md bg-neon-green/20 border border-neon-green/40 text-neon-green font-mono font-black text-xs">
                                Dorsal #{lead.dorsal}
                              </span>
                              {lead.nombre && (
                                <span className="text-white font-bold text-xs">{lead.nombre}</span>
                              )}
                              {lead.notified ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-cyan-400 font-semibold">
                                  <CheckCircle2 className="w-3 h-3" /> Avisado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-yellow-300 font-semibold">
                                  ⏳ Esperando aviso
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-300 mt-1">
                              {lead.whatsapp && <span>📱 WhatsApp: <strong>{lead.whatsapp}</strong></span>}
                              {lead.whatsapp && lead.email && <span className="mx-1.5 text-gray-500">·</span>}
                              {lead.email && <span>✉️ {lead.email}</span>}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => markLeadNotified(leadsModalAlbum.id, lead.id, true)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 transition-colors inline-flex items-center gap-1.5"
                            >
                              <span>📲 Enviar WhatsApp</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => handleDeleteLead(leadsModalAlbum.id, lead.id)}
                              className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                              title="Eliminar registro"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div className="flex justify-end pt-2 border-t border-dark-600">
                <button
                  type="button"
                  onClick={() => setLeadsModalAlbum(null)}
                  className="btn-outline-neon text-xs py-2 px-4"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
