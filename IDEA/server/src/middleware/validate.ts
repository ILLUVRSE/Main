// server/src/middleware/validate.ts
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export function validateSchema(schema:any) {
  const validator = ajv.compile(schema);
  return (req:any, res:any, next:any) => {
    const valid = validator(req.body);
    if (!valid) {
      return res.status(422).json({
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Request body validation failed',
          details: validator.errors
        }
      });
    }
    next();
  };
}

