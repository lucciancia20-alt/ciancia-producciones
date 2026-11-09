// Seed data for Firestore - Demo albums and media
import { collection, addDoc, getDocs, Timestamp } from 'firebase/firestore';
import { db } from './config';

const ALBUMS_SEED = [
  {
    title: 'Trail Running - Córdoba Sierra 2024',
    slug: 'trail-running-cordoba-2024',
    category: 'Trail Running',
    date: Timestamp.fromDate(new Date('2024-10-15')),
    coverUrl: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&q=80',
    location: 'Córdoba, Argentina',
    description: 'Carrera de montaña por los cerros cordobeses. 42km de aventura pura.',
    totalMedia: 0,
    published: true,
    pricePhoto: 2000,
    priceVideo: 3000,
    createdAt: Timestamp.now(),
  },
  {
    title: 'Ciclismo MTB - Desafío Mendoza 2024',
    slug: 'ciclismo-mtb-mendoza-2024',
    category: 'Ciclismo',
    date: Timestamp.fromDate(new Date('2024-09-22')),
    coverUrl: 'https://images.unsplash.com/photo-1534787238916-9ba6764efd4f?w=800&q=80',
    location: 'Mendoza, Argentina',
    description: 'MTB cross country en las estribaciones de la cordillera mendocina.',
    totalMedia: 0,
    published: true,
    pricePhoto: 2000,
    priceVideo: 3000,
    createdAt: Timestamp.now(),
  },
  {
    title: 'Fútbol Amateur - Liga Bonaerense',
    slug: 'futbol-liga-bonaerense-2024',
    category: 'Fútbol',
    date: Timestamp.fromDate(new Date('2024-11-01')),
    coverUrl: 'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=800&q=80',
    location: 'Buenos Aires, Argentina',
    description: 'Final de la Liga Bonaerense Amateur, temporada 2024.',
    totalMedia: 0,
    published: true,
    pricePhoto: 2000,
    priceVideo: 3000,
    createdAt: Timestamp.now(),
  },
  {
    title: 'Tomas de Dron - Patagonia 2024',
    slug: 'dron-patagonia-2024',
    category: 'Dron',
    date: Timestamp.fromDate(new Date('2024-08-10')),
    coverUrl: 'https://images.unsplash.com/photo-1521405924368-64c5b84bec60?w=800&q=80',
    location: 'Patagonia, Argentina',
    description: 'Vistas aéreas de la Patagonia argentina. Paisajes únicos desde las alturas.',
    totalMedia: 0,
    published: true,
    pricePhoto: 2000,
    priceVideo: 3000,
    createdAt: Timestamp.now(),
  },
];

// Demo media for each album (using public Unsplash images for demo)
const MEDIA_SEEDS = {
  'trail-running-cordoba-2024': [
    { type: 'photo', dorsals: ['101', '102'], bibs: ['101', '102'], helmetColors: [], bikeColors: [], jerseyColors: ['rojo', 'negro'], url: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&q=70', fileName: 'trail_101_102_001.jpg', price: 2000 },
    { type: 'photo', dorsals: ['101'], bibs: ['101'], helmetColors: [], bikeColors: [], jerseyColors: ['rojo'], url: 'https://images.unsplash.com/photo-1486218119243-13301543a212?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1486218119243-13301543a212?w=400&q=70', fileName: 'trail_101_002.jpg', price: 2000 },
    { type: 'photo', dorsals: ['103', '104'], bibs: ['103', '104'], helmetColors: [], bikeColors: [], jerseyColors: ['azul', 'fluor'], url: 'https://images.unsplash.com/photo-1502224562085-639556652f33?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1502224562085-639556652f33?w=400&q=70', fileName: 'trail_103_104_003.jpg', price: 2000 },
    { type: 'photo', dorsals: ['102'], bibs: ['102'], helmetColors: [], bikeColors: [], jerseyColors: ['negro'], url: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1541625602330-2277a4c46182?w=400&q=70', fileName: 'trail_102_004.jpg', price: 2000 },
    { type: 'photo', dorsals: ['105', '106', '107'], bibs: ['105', '106', '107'], helmetColors: [], bikeColors: [], jerseyColors: ['blanco', 'amarillo', 'verde'], url: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&q=70', fileName: 'trail_grupo_005.jpg', price: 2000 },
    { type: 'photo', dorsals: ['103'], bibs: ['103'], helmetColors: [], bikeColors: [], jerseyColors: ['azul'], url: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=400&q=70', fileName: 'trail_103_006.jpg', price: 2000 },
    { type: 'video', dorsals: ['101', '102'], bibs: ['101', '102'], helmetColors: [], bikeColors: [], jerseyColors: ['rojo', 'negro'], url: 'https://www.w3schools.com/html/mov_bbb.mp4', thumb: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=400&q=70', fileName: 'trail_101_102_clip.mp4', price: 3000, duration: '0:45' },
    { type: 'video', dorsals: ['103'], bibs: ['103'], helmetColors: [], bikeColors: [], jerseyColors: ['azul'], url: 'https://www.w3schools.com/html/movie.mp4', thumb: 'https://images.unsplash.com/photo-1502224562085-639556652f33?w=400&q=70', fileName: 'trail_103_clip.mp4', price: 3000, duration: '1:12' },
  ],
  'ciclismo-mtb-mendoza-2024': [
    { type: 'photo', dorsals: ['201', '202'], bibs: ['201', '202'], helmetColors: ['blanco', 'negro'], bikeColors: ['rojo', 'negro'], jerseyColors: ['azul', 'amarillo'], url: 'https://images.unsplash.com/photo-1534787238916-9ba6764efd4f?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1534787238916-9ba6764efd4f?w=400&q=70', fileName: 'mtb_201_001.jpg', price: 2000 },
    { type: 'photo', dorsals: ['201'], bibs: ['201'], helmetColors: ['blanco'], bikeColors: ['rojo'], jerseyColors: ['azul'], url: 'https://images.unsplash.com/photo-1558981852-426c127e4ee6?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1558981852-426c127e4ee6?w=400&q=70', fileName: 'mtb_201_002.jpg', price: 2000 },
    { type: 'photo', dorsals: ['203'], bibs: ['203'], helmetColors: ['negro'], bikeColors: ['verde', 'negro'], jerseyColors: ['naranja', 'negro'], url: 'https://images.unsplash.com/photo-1507035895480-2b3156c31fc8?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1507035895480-2b3156c31fc8?w=400&q=70', fileName: 'mtb_203_003.jpg', price: 2000 },
    { type: 'photo', dorsals: ['202', '204'], bibs: ['202', '204'], helmetColors: ['negro', 'fluor'], bikeColors: ['negro', 'celeste'], jerseyColors: ['amarillo', 'fluor'], url: 'https://images.unsplash.com/photo-1619037961381-7b5cb5a85b2b?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1619037961381-7b5cb5a85b2b?w=400&q=70', fileName: 'mtb_202_204_004.jpg', price: 2000 },
    { type: 'video', dorsals: ['201'], bibs: ['201'], helmetColors: ['blanco'], bikeColors: ['rojo'], jerseyColors: ['azul'], url: 'https://www.w3schools.com/html/mov_bbb.mp4', thumb: 'https://images.unsplash.com/photo-1534787238916-9ba6764efd4f?w=400&q=70', fileName: 'mtb_201_clip.mp4', price: 3000, duration: '0:58' },
  ],
  'futbol-liga-bonaerense-2024': [
    { type: 'photo', dorsals: ['9', '10'], url: 'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=400&q=70', fileName: 'futbol_9_10_001.jpg', price: 2000 },
    { type: 'photo', dorsals: ['7'], url: 'https://images.unsplash.com/photo-1570498839593-e565b39455fc?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1570498839593-e565b39455fc?w=400&q=70', fileName: 'futbol_7_002.jpg', price: 2000 },
    { type: 'photo', dorsals: ['11', '7'], url: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=400&q=70', fileName: 'futbol_11_7_003.jpg', price: 2000 },
    { type: 'photo', dorsals: ['5'], url: 'https://images.unsplash.com/photo-1529900748604-07564a03e7a6?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1529900748604-07564a03e7a6?w=400&q=70', fileName: 'futbol_5_004.jpg', price: 2000 },
    { type: 'video', dorsals: ['9', '10', '7'], url: 'https://www.w3schools.com/html/movie.mp4', thumb: 'https://images.unsplash.com/photo-1575361204480-aadea25e6e68?w=400&q=70', fileName: 'futbol_gol_clip.mp4', price: 3000, duration: '1:30' },
  ],
  'dron-patagonia-2024': [
    { type: 'photo', dorsals: [], url: 'https://images.unsplash.com/photo-1521405924368-64c5b84bec60?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1521405924368-64c5b84bec60?w=400&q=70', fileName: 'dron_patagonia_001.jpg', price: 2000 },
    { type: 'photo', dorsals: [], url: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=70', fileName: 'dron_patagonia_002.jpg', price: 2000 },
    { type: 'photo', dorsals: [], url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&q=70', fileName: 'dron_patagonia_003.jpg', price: 2000 },
    { type: 'photo', dorsals: [], url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=85', thumb: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=70', fileName: 'dron_patagonia_004.jpg', price: 2000 },
    { type: 'video', dorsals: [], url: 'https://www.w3schools.com/html/mov_bbb.mp4', thumb: 'https://images.unsplash.com/photo-1521405924368-64c5b84bec60?w=400&q=70', fileName: 'dron_patagonia_aerial_clip.mp4', price: 3000, duration: '2:15' },
    { type: 'video', dorsals: [], url: 'https://www.w3schools.com/html/movie.mp4', thumb: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=70', fileName: 'dron_patagonia_sunset_clip.mp4', price: 12000, duration: '1:45' },
  ],
};

export async function seedFirestore() {
  const albumsRef = collection(db, 'albums');
  const existing = await getDocs(albumsRef);

  if (!existing.empty) {
    return { alreadySeeded: true, count: existing.size };
  }

  let albumsCreated = 0;
  let mediaCreated = 0;

  for (const albumData of ALBUMS_SEED) {
    const mediaItems = MEDIA_SEEDS[albumData.slug] || [];
    const albumWithCount = { ...albumData, totalMedia: mediaItems.length };
    const albumRef = await addDoc(albumsRef, albumWithCount);
    albumsCreated++;

    for (const item of mediaItems) {
      await addDoc(collection(db, 'media'), {
        ...item,
        albumId: albumRef.id,
        albumSlug: albumData.slug,
        albumTitle: albumData.title,
        approved: true,
        createdAt: Timestamp.now(),
      });
      mediaCreated++;
    }
  }

  return { alreadySeeded: false, albumsCreated, mediaCreated };
}
