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
 * GET /api/resources
 * Lista recursos de Cloudinary (útil para auditoría / diagnosticar huérfanos)
 */
app.get('/api/resources', async (req, res) => {
  try {
    const prefix = req.query.prefix || '';
    const result = await cloudinary.api.resources({
      type: 'upload',
      prefix,
      max_results: 100,
    });
    return res.json(result);
  } catch (error) {
    console.error('[GET /api/resources] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/folder
 * Body JSON: { folder: string }
 * Destruye todas las imágenes y videos bajo esa carpeta y luego elimina la carpeta misma.
 */
app.delete('/api/folder', async (req, res) => {
  try {
    const { folder } = req.body || {};
    if (!folder || typeof folder !== 'string') {
      return res.status(400).json({ ok: false, error: 'El parámetro "folder" es obligatorio.' });
    }
    const cleanFolder = folder.replace(/^\/+|\/+$/g, '');

    // 1. Borrar todas las imágenes con ese prefijo
    const imgRes = await cloudinary.api.delete_resources_by_prefix(cleanFolder, { resource_type: 'image' }).catch(() => null);
    // 2. Borrar todos los videos con ese prefijo
    const vidRes = await cloudinary.api.delete_resources_by_prefix(cleanFolder, { resource_type: 'video' }).catch(() => null);
    // 3. Borrar la carpeta en Cloudinary
    await cloudinary.api.delete_folder(cleanFolder).catch(() => null);

    return res.json({ ok: true, folder: cleanFolder, imgRes, vidRes });
  } catch (error) {
    console.error('[DELETE /api/folder] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
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

    const cleanPid = public_id.trim();
    let result = await cloudinary.uploader.destroy(cleanPid, {
      resource_type,
      invalidate: true,
    });

    // Si no se encontró como imagen, intentar como video automáticamente
    if (result?.result === 'not found' && resource_type === 'image') {
      const vidResult = await cloudinary.uploader.destroy(cleanPid, {
        resource_type: 'video',
        invalidate: true,
      });
      if (vidResult?.result === 'ok') {
        result = vidResult;
      }
    }

    return res.status(200).json({
      ok: true,
      public_id: cleanPid,
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
