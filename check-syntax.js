const parser = require('@babel/parser');
const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
    try {
        const code = fs.readFileSync(f, 'utf8');
        parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
        console.log('OK:', f);
    } catch (e) {
        console.log('ERR:', f);
        console.log('  line', e.loc?.line, 'col', e.loc?.column, ':', e.message);
    }
}
