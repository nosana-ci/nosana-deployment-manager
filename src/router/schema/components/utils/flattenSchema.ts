import { TSchema } from "@sinclair/typebox";

type SchemaValue =
  | string
  | number
  | boolean
  | null
  | SchemaObject
  | RefObject
  | SchemaValue[];

export interface SchemaObject {
  readonly [key: string]: SchemaValue;
}

interface RefObject {
  readonly $ref: string;
}

type SchemaWithRefs = SchemaObject | RefObject | SchemaValue;

export function flattenSchema(schema: TSchema, allComponents: Record<string, SchemaObject>): TSchema {
  const components = new Map<string, SchemaObject>();

  // Load all available components
  Object.entries(allComponents).forEach(([key, value]) => {
    if (isSchemaObject(value)) {
      components.set(key, value);
    }
  });

  function resolveRefs(obj: SchemaWithRefs): SchemaValue {
    if (isRefObject(obj)) {
      const refName = obj.$ref.replace('#/components/schemas/', '');
      if (components.has(refName)) {
        return resolveRefs(components.get(refName)!);
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(resolveRefs);
    }

    if (isSchemaObject(obj)) {
      const result: Record<string, SchemaValue> = {};
      Object.entries(obj).forEach(([key, value]) => {
        result[key] = resolveRefs(value);
      });
      return result;
    }

    return obj;
  }

  return resolveRefs(schema) as TSchema;
}

// Type guards
function isSchemaObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRefObject(value: unknown): value is RefObject {
  return isSchemaObject(value) && '$ref' in value && typeof value.$ref === 'string';
}