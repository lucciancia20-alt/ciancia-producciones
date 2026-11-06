import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ChevronRight, MapPin, Calendar, Image as ImageIcon } from 'lucide-react';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
}

const CATEGORY_COLORS = {
  'Trail Running': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Ciclismo':      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Fútbol':        'bg-green-500/20 text-green-400 border-green-500/30',
  'Dron':          'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Natación':      'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Atletismo':     'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

export default function AlbumCard({ album }) {
  const [cover, setCover] = useState(album.coverUrl || album.coverImage || null);
  const [imgError, setImgError] = useState(false);

  // Si el álbum no tiene portada guardada, obtenemos la primera foto subida a Cloudinary
  useEffect(() => {
    let isMounted = true;
    if (!cover && album.id) {
      async function fetchFirstPhoto() {
        try {
          const q = query(
            collection(db, 'media'),
            where('albumId', '==', album.id),
            limit(1)
          );
          const snap = await getDocs(q);
          if (!snap.empty && isMounted) {
            const first = snap.docs[0].data();
            const photoUrl = first.thumb || first.url;
            if (photoUrl) {
              setCover(photoUrl);
            }
          }
        } catch (e) {
          console.warn('[AlbumCard] Error al buscar foto de portada:', e);
        }
      }
      fetchFirstPhoto();
    }
    return () => { isMounted = false; };
  }, [album.id, cover]);

  const catClass = CATEGORY_COLORS[album.category] || 'bg-gray-500/20 text-gray-300 border-gray-500/30';

  return (
    <Link
      to={`/album/${album.id}`}
      className="group relative overflow-hidden rounded-2xl border border-dark-600 bg-dark-800 hover:border-neon-green/60 transition-all duration-300 hover:shadow-xl hover:shadow-neon-green/10 flex flex-col h-72 sm:h-80 select-none"
    >
      {/* ── Imagen de portada de fondo con degradado profesional ── */}
      {cover && !imgError ? (
        <img
          src={cover}
          alt=""
          role="presentation"
          onError={() => setImgError(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-dark-700 via-dark-800 to-dark-900 flex items-center justify-center">
          <ImageIcon className="w-16 h-16 text-dark-500/40" />
        </div>
      )}

      {/* Degradado oscuro para garantizar legibilidad perfecta del texto */}
      <div className="absolute inset-0 bg-gradient-to-t from-dark-950 via-dark-950/60 to-black/30 pointer-events-none transition-colors duration-300 group-hover:via-dark-950/50" />

      {/* ── Barra superior: Etiquetas separadas en flex (sin superposición) ── */}
      <div className="relative z-10 p-4 flex items-center justify-between gap-2">
        <span className={`text-xs font-bold px-3 py-1 rounded-full border backdrop-blur-sm shadow-sm ${catClass}`}>
          {album.category || 'Deportes'}
        </span>

        <span className="bg-black/75 border border-dark-500/80 rounded-full px-3 py-1 flex items-center gap-1.5 text-xs font-semibold text-white backdrop-blur-sm shadow-sm">
          <Camera className="w-3.5 h-3.5 text-neon-green" />
          <span>{album.totalMedia || 0}</span>
        </span>
      </div>

      {/* Espaciador flexible para empujar la info hacia el fondo */}
      <div className="flex-1" />

      {/* ── Contenido inferior: Título, ubicación, fecha y CTA ── */}
      <div className="relative z-10 p-5 pt-0 space-y-1.5">
        <h3 className="font-black text-white text-xl sm:text-2xl leading-tight group-hover:text-neon-green transition-colors drop-shadow-md line-clamp-2">
          {album.title}
        </h3>

        <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-gray-300 text-xs font-medium">
          {album.location && (
            <span className="flex items-center gap-1 drop-shadow-sm">
              <MapPin className="w-3.5 h-3.5 text-neon-green flex-shrink-0" />
              <span>{album.location}</span>
            </span>
          )}
          {album.date && (
            <span className="flex items-center gap-1 text-gray-400 drop-shadow-sm">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{formatDate(album.date)}</span>
            </span>
          )}
        </div>

        {/* Indicador interactivo en hover */}
        <div className="pt-1 flex items-center text-neon-green text-xs font-bold gap-1 transform transition-transform duration-200 group-hover:translate-x-1">
          <span>Ver fotos</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </div>
    </Link>
  );
}
