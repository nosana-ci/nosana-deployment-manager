
export function skipSwaggerValidation() {
  return (data: unknown) => JSON.stringify(data);
}