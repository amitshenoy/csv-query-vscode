const tsParser=require('@typescript-eslint/parser');
module.exports=[{files:['src/**/*.ts'],languageOptions:{parser:tsParser},rules:{semi:'warn','@typescript-eslint/no-explicit-any':'off'}}];
