import React from 'react';
import { Link } from 'react-router-dom';
import { Camera, Video, ChevronRight, MapPin, Calendar } from 'lucide-react';

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' });
}

const CATEGORY_COLORS = {
  'Trail Running': 'bg-orange-500/20 text-orange-400',
  'Ciclismo': 'bg-blue-500/20 text-blue-400',
  'Fútbol': 'bg-green-500/20 text-green-400',
  'Dron': 'bg-purple-500/20 text-purple-400',
};

export default function AlbumCard({ album }) {
  const catClass = CATEGORY_COLORS[album.category] || 'bg-gray-500/20 text-gray-400';

  return (
    <Link to={`/album/${album.id}`} className="group card-dark hover:border-neon-green/50 hover:shadow-lg hover:shadow-neon-green/10 block">
      {/* Cover image */}
      <div className="relative overflow-hidden h-52">
        <img
          src={album.coverUrl}
          alt={album.title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {/* Category badge */}
        <span className={`absolute top-3 left-3 text-xs font-bold px-2 py-1 rounded-full backdrop-blur-sm ${catClass}`}>
          {album.category}
        </span>
        {/* Media count */}
        <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1 text-xs text-white">
          <Camera className="w-3 h-3" />
          <span>{album.totalMedia || 0}</span>
        </div>
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
          <span className="text-neon-green text-sm font-bold flex items-center gap-1">
            Ver álbum <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-bold text-white text-base leading-tight mb-2 group-hover:text-neon-green transition-colors line-clamp-2">
          {album.title}
        </h3>
        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
          <MapPin className="w-3 h-3 flex-shrink-0" />
          <span>{album.location}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-400 text-xs">
          <Calendar className="w-3 h-3 flex-shrink-0" />
          <span>{formatDate(album.date)}</span>
        </div>
      </div>
    </Link>
  );
}
