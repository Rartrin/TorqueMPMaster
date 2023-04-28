import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'index.js',
  target: ['node16']
})

await esbuild.build({
  entryPoints: ['relay/index.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'relay.js',
  target: ['node16']
})