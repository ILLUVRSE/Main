import { Request, Response, NextFunction, RequestHandler } from 'express';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { dereference } from '@apidevtools/json-schema-ref-parser';

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';

type PathMatcher = {
  test: (pathname: string) => { match: boolean; params: Record<string, string> };
};

interface OperationValidators {
  method: HttpMethod;
  path: string;
  matcher: PathMatcher;
  requestBody?: ValidateFunction;
  responseValidators: Record<string, ValidateFunction>;
  parameterValidators: {
    path?: ValidateFunction;
    query?: ValidateFunction;
  };
}

interface ValidationIssue {
  location: 'body' | 'query' | 'path' | 'response';
  message: string;
  path?: string;
  keyword?: string;
  status?: number;
}

interface ValidatorContext {
  operation: OperationValidators;
  skipResponseValidation: boolean;
}

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];

function compilePathMatcher(pathPattern: string): PathMatcher {
  const names: string[] = [];
  const escaped = pathPattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, (c) => `\\${c}`)
    .replace(/\\\{([^}]+)\\\}/g, (_match, name: string) => {
      names.push(name);
      return '([^/]+)';
    });
  const regex = new RegExp(`^${escaped}$`);
  return {
    test(pathname: string) {
      const m = regex.exec(pathname);
      if (!m) {
        return { match: false, params: {} };
      }
      const params: Record<string, string> = {};
      names.forEach((name, idx) => {
        const value = m[idx + 1];
        params[name] = value ? decodeURIComponent(value) : value;
      });
      return { match: true, params };
    },
  };
}

function toIssues(location: ValidationIssue['location'], errors: ErrorObject[] | null | undefined, status?: number): ValidationIssue[] {
  if (!errors || !errors.length) return [];
  return errors.map((err) => {
    const pointer = err.instancePath ? err.instancePath.replace(/^\//, '') : '';
    return {
      location,
      message: err.message || 'invalid',
      path: pointer || undefined,
      keyword: err.keyword,
      status,
    };
  });
}

function respondWithIssues(res: Response, issues: ValidationIssue[], context?: ValidatorContext): void {
  if (context) {
    context.skipResponseValidation = true;
  }
  res.status(400).json({ error: 'validation_error', details: issues });
}

function installResponseValidation(res: Response, context: ValidatorContext): void {
  const { operation } = context;
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  const validateAndSend = (body: any, parsed: any, sender: (payload: any) => Response) => {
    if (context.skipResponseValidation) {
      return sender(body);
    }
    const statusCode = res.statusCode || 200;
    const key = String(statusCode);
    const validator = operation.responseValidators[key] || operation.responseValidators.default;
    if (!validator) {
      return sender(body);
    }
    const ok = validator(parsed);
    if (!ok) {
      const issues = toIssues('response', validator.errors, statusCode);
      context.skipResponseValidation = true;
      res.status(400);
      return originalJson({ error: 'validation_error', details: issues });
    }
    return sender(body);
  };

  res.json = ((body?: any) => {
    return validateAndSend(body, body, originalJson);
  }) as typeof res.json;

  res.send = ((body?: any) => {
    if (context.skipResponseValidation) {
      return originalSend(body);
    }
    if (body === undefined || body === null) {
      return originalSend(body);
    }
    if (Buffer.isBuffer(body)) {
      return originalSend(body);
    }
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return validateAndSend(body, parsed, originalSend);
      } catch {
        return originalSend(body);
      }
    }
    return validateAndSend(body, body, originalSend);
  }) as typeof res.send;
}

function buildParameterValidator(ajv: Ajv, parameters: any[], location: 'path' | 'query'): ValidateFunction | undefined {
  if (!parameters || !parameters.length) {
    return undefined;
  }
  const props: Record<string, any> = {};
  const required: string[] = [];
  for (const param of parameters) {
    if (!param || param.in !== location) continue;
    const schema = param.schema || {};
    props[param.name] = schema;
    if (param.required) {
      required.push(param.name);
    }
  }
  const keys = Object.keys(props);
  if (!keys.length) {
    return undefined;
  }
  return ajv.compile({
    type: 'object',
    properties: props,
    required: required.length ? required : undefined,
  });
}

function extractJsonSchema(content: any): any | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const jsonContent = content['application/json'];
  if (!jsonContent || typeof jsonContent !== 'object') return undefined;
  return jsonContent.schema;
}

async function buildOperations(apiSpec: any, ajv: Ajv): Promise<OperationValidators[]> {
  const deref = (await dereference(JSON.parse(JSON.stringify(apiSpec)))) as any;
  const operations: OperationValidators[] = [];
  const paths: Record<string, any> = (deref && typeof deref === 'object' ? deref.paths : undefined) || {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    const sharedParams = Array.isArray((pathItem as any)?.parameters) ? (pathItem as any).parameters : [];
    for (const method of METHODS) {
      const operation = (pathItem as any)?.[method];
      if (!operation) continue;
      const opParams = Array.isArray(operation.parameters) ? operation.parameters : [];
      const allParams = [...sharedParams, ...opParams];
      const requestSchema = extractJsonSchema(operation.requestBody?.content);
      const requestBody = requestSchema ? ajv.compile(requestSchema) : undefined;
      const responses = operation.responses || {};
      const responseValidators: Record<string, ValidateFunction> = {};
      for (const [status, response] of Object.entries(responses)) {
        const schema = extractJsonSchema((response as any)?.content);
        if (schema) {
          responseValidators[status] = ajv.compile(schema);
        }
      }
      const parameterValidators = {
        path: buildParameterValidator(ajv, allParams, 'path'),
        query: buildParameterValidator(ajv, allParams, 'query'),
      };
      operations.push({
        method,
        path: pathKey,
        matcher: compilePathMatcher(pathKey),
        requestBody,
        responseValidators,
        parameterValidators,
      });
    }
  }
  return operations;
}

function findOperation(
  operations: OperationValidators[],
  method: string,
  pathname: string,
): { operation: OperationValidators; params: Record<string, string> } | undefined {
  const lower = method.toLowerCase();
  for (const op of operations) {
    if (op.method !== lower) continue;
    const result = op.matcher.test(pathname);
    if (result.match) {
      return { operation: op, params: result.params };
    }
  }
  return undefined;
}

function validateParameters(
  validator: ValidateFunction | undefined,
  value: any,
  location: 'path' | 'query',
  issues: ValidationIssue[],
): void {
  if (!validator) return;
  const ok = validator(value || {});
  if (!ok) {
    issues.push(...toIssues(location, validator.errors));
  }
}

export async function createOpenApiValidator(apiSpec: any): Promise<RequestHandler> {
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: true });
  addFormats(ajv);

  const operations = await buildOperations(apiSpec, ajv);

  return function openApiValidator(req: Request, res: Response, next: NextFunction) {
    try {
      const match = findOperation(operations, req.method, req.path);
      if (!match) {
        return next();
      }

      const context: ValidatorContext = {
        operation: match.operation,
        skipResponseValidation: false,
      };

      const issues: ValidationIssue[] = [];

      validateParameters(match.operation.parameterValidators.path, match.params, 'path', issues);
      if (issues.length) {
        return respondWithIssues(res, issues, context);
      }

      validateParameters(match.operation.parameterValidators.query, req.query, 'query', issues);
      if (issues.length) {
        return respondWithIssues(res, issues, context);
      }

      if (match.operation.requestBody) {
        const ok = match.operation.requestBody(req.body);
        if (!ok) {
          issues.push(...toIssues('body', match.operation.requestBody.errors));
        }
      }

      if (issues.length) {
        return respondWithIssues(res, issues, context);
      }

      installResponseValidation(res, context);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

