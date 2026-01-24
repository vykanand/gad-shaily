const fs = require('fs');
const path = require('path');

const content = fs.readFileSync('c:/dev/gad-shaily/index.html', 'utf8');
const lines = content.split('\n');

for (let i = 4290; i < 4360; i++) {
    if (lines[i]) {
        console.log(`${i + 1}: ${lines[i]}`);
    }
}

