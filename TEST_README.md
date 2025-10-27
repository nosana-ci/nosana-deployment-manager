# Testing Guide

This project uses [Vitest](https://vitest.dev/) for unit testing.

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## Writing Tests

Tests should be placed next to the source files they test with a `.test.ts` or `.spec.ts` extension.

For example:
- `src/utils/helper.ts` → `src/utils/helper.test.ts`

### Example Test Structure

```typescript
import { describe, it, expect } from 'vitest';
import { yourFunction } from './yourModule.js';

describe('yourFunction', () => {
  it('should do something specific', () => {
    const result = yourFunction('input');
    expect(result).toBe('expected output');
  });
});
```

## Test Organization

- **Unit Tests**: Test individual functions and modules in isolation
  - Place test files next to source files: `*.test.ts`
  - Mock external dependencies when needed

- **Integration Tests**: Test how multiple modules work together
  - Can be placed in a separate `test/` directory if preferred
  - Should test realistic scenarios

## Best Practices

1. **Descriptive Test Names**: Use clear descriptions that explain what is being tested
   ```typescript
   it('should return true when value equals the operator value', () => {
     // test implementation
   });
   ```

2. **Arrange-Act-Assert Pattern**:
   ```typescript
   it('should calculate total correctly', () => {
     // Arrange: Set up test data
     const items = [{ price: 10 }, { price: 20 }];

     // Act: Execute the function
     const total = calculateTotal(items);

     // Assert: Verify the result
     expect(total).toBe(30);
   });
   ```

3. **Test Edge Cases**: Consider boundary conditions, empty inputs, and error scenarios

4. **Keep Tests Isolated**: Each test should be independent and not rely on other tests

5. **Use Mocks Sparingly**: Only mock what's necessary for the test

## Coverage

Coverage reports are generated in the `coverage/` directory when running `npm run test:coverage`.

Aim for meaningful coverage, not just high percentages. Focus on:
- Critical business logic
- Complex algorithms
- Edge cases and error handling
- Public API surfaces

## CI/CD Integration

Tests run automatically in the GitLab CI pipeline for:
- Merge requests
- Main branch commits

The pipeline will fail if any tests fail.

## Example Tests

See the following files for test examples:
- `src/client/listener/helpers/matchValue.test.ts`
- `src/client/listener/helpers/matchFilter.test.ts`

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest API Reference](https://vitest.dev/api/)
