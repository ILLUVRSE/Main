"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOpenApiValidator = createOpenApiValidator;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const json_schema_ref_parser_1 = require("@apidevtools/json-schema-ref-parser");
const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
function compilePathMatcher(pathPattern) {
    const names = [];
    const escaped = pathPattern
        .replace(/[-/\\^$+?.()|[\]{}]/g, (c) => `\\${c}`)
        .replace(/\\\{([^}]+)\\\}/g, (_match, name) => {
        names.push(name);
        return '([^/]+)';
    });
    const regex = new RegExp(`^${escaped}$`);
    return {
        test(pathname) {
            const m = regex.exec(pathname);
            if (!m) {
                return { match: false, params: {} };
            }
            const params = {};
            names.forEach((name, idx) => {
                const value = m[idx + 1];
                params[name] = value ? decodeURIComponent(value) : value;
            });
            return { match: true, params };
        },
    };
}
function toIssues(location, errors, status) {
    if (!errors || !errors.length)
        return [];
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
function respondWithIssues(res, issues, context) {
    if (context) {
        context.skipResponseValidation = true;
    }
    res.status(400).json({ error: 'validation_error', details: issues });
}
function installResponseValidation(res, context) {
    const { operation } = context;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const validateAndSend = (body, parsed, sender) => {
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
    res.json = ((body) => {
        return validateAndSend(body, body, originalJson);
    });
    res.send = ((body) => {
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
            }
            catch {
                return originalSend(body);
            }
        }
        return validateAndSend(body, body, originalSend);
    });
}
function buildParameterValidator(ajv, parameters, location) {
    if (!parameters || !parameters.length) {
        return undefined;
    }
    const props = {};
    const required = [];
    for (const param of parameters) {
        if (!param || param.in !== location)
            continue;
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
function extractJsonSchema(content) {
    if (!content || typeof content !== 'object')
        return undefined;
    const jsonContent = content['application/json'];
    if (!jsonContent || typeof jsonContent !== 'object')
        return undefined;
    return jsonContent.schema;
}
async function buildOperations(apiSpec, ajv) {
    const deref = (await (0, json_schema_ref_parser_1.dereference)(JSON.parse(JSON.stringify(apiSpec))));
    const operations = [];
    const paths = (deref && typeof deref === 'object' ? deref.paths : undefined) || {};
    for (const [pathKey, pathItem] of Object.entries(paths)) {
        const sharedParams = Array.isArray(pathItem?.parameters) ? pathItem.parameters : [];
        for (const method of METHODS) {
            const operation = pathItem?.[method];
            if (!operation)
                continue;
            const opParams = Array.isArray(operation.parameters) ? operation.parameters : [];
            const allParams = [...sharedParams, ...opParams];
            const requestSchema = extractJsonSchema(operation.requestBody?.content);
            const requestBody = requestSchema ? ajv.compile(requestSchema) : undefined;
            const responses = operation.responses || {};
            const responseValidators = {};
            for (const [status, response] of Object.entries(responses)) {
                const schema = extractJsonSchema(response?.content);
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
function findOperation(operations, method, pathname) {
    const lower = method.toLowerCase();
    for (const op of operations) {
        if (op.method !== lower)
            continue;
        const result = op.matcher.test(pathname);
        if (result.match) {
            return { operation: op, params: result.params };
        }
    }
    return undefined;
}
function validateParameters(validator, value, location, issues) {
    if (!validator)
        return;
    const ok = validator(value || {});
    if (!ok) {
        issues.push(...toIssues(location, validator.errors));
    }
}
async function createOpenApiValidator(apiSpec) {
    const ajv = new ajv_1.default({ allErrors: true, strict: false, coerceTypes: true });
    (0, ajv_formats_1.default)(ajv);
    const operations = await buildOperations(apiSpec, ajv);
    return function openApiValidator(req, res, next) {
        try {
            const match = findOperation(operations, req.method, req.path);
            if (!match) {
                return next();
            }
            const context = {
                operation: match.operation,
                skipResponseValidation: false,
            };
            const issues = [];
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
        }
        catch (err) {
            return next(err);
        }
    };
}
