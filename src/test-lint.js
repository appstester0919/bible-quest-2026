// Test file with intentional lint error
const x = 1;
if (x) {
  console.log('test');
}

// Unused variable - should trigger eslint warning
const unusedVariable = 'this is not used';
