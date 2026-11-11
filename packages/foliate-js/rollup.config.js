import { nodeResolve } from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import { copy } from 'fs-extra'

const copyPDFJS = () => ({
    name: 'copy-pdfjs',
    async writeBundle() {
        await copy('node_modules/pdfjs-dist/cmaps', 'vendor/pdfjs/cmaps')
        await copy('node_modules/pdfjs-dist/standard_fonts', 'vendor/pdfjs/standard_fonts')
    },
})

export default [{
    input: 'rollup/fflate.js',
    output: {
        dir: 'vendor/',
        format: 'esm',
    },
    plugins: [nodeResolve(), terser()],
},
{
    input: 'rollup/zip.js',
    output: {
        dir: 'vendor/',
        format: 'esm',
    },
    plugins: [nodeResolve(), terser(), copyPDFJS()],
}]
