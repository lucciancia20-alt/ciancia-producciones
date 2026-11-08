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

  return (
    <Link
      to={`/album/${album.id}`}
      className="group relative overflow-hidden rounded-2xl border border-dark-600 bg-dark-800 hover:border-neon-green/60 transition-all duration-300 hover:shadow-xl hover:shadow-neon-green/10 flex flex-col h-56 sm:h-60 select-none"
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
          <ImageIcon className="w-14 h-14 text-dark-500/40" />
        </div>
      )}

      {/* Degradado oscuro de alto contraste para garantizar legibilidad perfecta sobre fotos claras o soleadas */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/15 to-black/95 pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black via-black/85 to-transparent pointer-events-none" />

      {/* ── Barra superior: Etiquetas con fondo oscuro sólido de alto contraste ── */}
      <div className="relative z-10 p-3 flex items-center justify-between gap-2">
        <span className="bg-black/85 border border-neon-green/60 text-neon-green text-[11px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-md shadow-md flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-neon-green flex-shrink-0" />
          <span>{album.category || 'Deportes'}</span>
        </span>

        <span className="bg-black/85 border border-dark-500/90 rounded-full px-2.5 py-0.5 flex items-center gap-1 text-[11px] font-bold text-white backdrop-blur-md shadow-md">
          <Camera className="w-3 h-3 text-neon-green" />
          <span>{album.totalMedia || 0}</span>
        </span>
      </div>

      {/* Espaciador flexible para empujar la info hacia el fondo */}
      <div className="flex-1" />

      {/* ── Contenido inferior: Título, ubicación, fecha y CTA de alto contraste ── */}
      <div className="relative z-10 p-4 pt-0 space-y-1.5">
        <h3
          className="font-black text-white text-lg sm:text-xl leading-tight group-hover:text-neon-green transition-colors line-clamp-2"
          style={{ textShadow: '0 2px 6px rgba(0,0,0,0.95)' }}
        >
          {album.title}
        </h3>

        <div className="flex flex-col gap-0.5 text-white text-xs font-semibold">
          {album.location && (
            <span
              className="flex items-center gap-1.5"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}
            >
              <MapPin className="w-3 h-3 text-neon-green flex-shrink-0" />
              <span className="truncate">{album.location}</span>
            </span>
          )}
          {album.date && (
            <span
              className="flex items-center gap-1.5 text-gray-100"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}
            >
              <Calendar className="w-3 h-3 text-neon-green flex-shrink-0" />
              <span>{formatDate(album.date)}</span>
            </span>
          )}
        </div>

        {/* Botón "Ver fotos >" con contraste sólido para verse nítido sobre cualquier foto */}
        <div className="pt-0.5">
          <span className="inline-flex items-center gap-1 bg-neon-green text-black text-xs font-extrabold px-2.5 py-1 rounded-lg shadow-md transform transition-transform duration-200 group-hover:translate-x-1">
            <span>Ver fotos</span>
            <ChevronRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </span>
        </div>
      </div>
    </Link>
  );
}
