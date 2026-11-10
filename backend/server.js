import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v2 as cloudinary } from 'cloudinary';

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de Cloudinary v2 con variables de entorno seguras en Render
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Middlewares
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',') : '*',
  methods: ['GET', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());

// Healthcheck para Render
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'ciancia-cloudinary-api' });
});

/**
 * DELETE /api/media
 * Body JSON: { public_id: string, resource_type?: 'image' | 'video' | 'raw' }
 */
app.delete('/api/media', async (req, res) => {
  try {
    const { public_id, resource_type = 'image' } = req.body || {};

    if (!public_id || typeof public_id !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'El parámetro "public_id" es obligatorio.',
      });
    }

    const result = await cloudinary.uploader.destroy(public_id.trim(), {
      resource_type,
      invalidate: true,
    });

    return res.status(200).json({
      ok: true,
      public_id,
      result: result?.result || 'unknown',
    });
  } catch (error) {
    console.error('[DELETE /api/media] Error en Cloudinary destroy:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Error interno al eliminar el archivo de Cloudinary.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Microservicio Cloudinary corriendo en el puerto ${PORT}`);
});
