import formidable from 'formidable';
import { requireCaller, sendError } from '@/lib/serverAuth';
import { cloudinary } from '@/lib/mediaStore';

const ALLOWED_RESOURCE_TYPES = ['auto', 'image', 'raw', 'video'];

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Uploads are billed to our Cloudinary account, so the caller must be a
    // signed-in user rather than anyone who finds the endpoint.
    await requireCaller(req);

    const form = formidable({
      maxFileSize: 10 * 1024 * 1024 // 10MB
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, parsedFields, parsedFiles) => {
        if (err) reject(err);
        else resolve([parsedFields, parsedFiles]);
      });
    });

    const file = files?.file?.[0];

    if (!file) {
      return res.status(400).json({ message: 'No file provided' });
    }

    // Callers may pin the resource type. Under 'auto' Cloudinary files a PDF as
    // an image, so documents uploaded here would not match the 'raw' assets the
    // upload widget produces for the same file.
    const requested = fields?.resourceType?.[0];
    const resourceType = ALLOWED_RESOURCE_TYPES.includes(requested) ? requested : 'auto';

    const result = await cloudinary.uploader.upload(file.filepath, {
      upload_preset: 'syncnote',
      resource_type: resourceType
    });

    // The public ID is what Cloudinary deletes by. Returning it here is what
    // lets the client store a record that can later be deleted reliably,
    // instead of reverse-engineering an ID out of the delivery URL.
    return res.status(200).json({
      secure_url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type,
      bytes: result.bytes,
      format: result.format
    });
  } catch (error) {
    return sendError(res, error, 'Upload error');
  }
}
