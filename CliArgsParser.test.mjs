import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { map } from './CliArgsParser.mjs'

describe('ArgsParser', () => {
    it('Should parse an array of key value arguments separated by a space into an object', () => {
        const args = ['--help', '--folder', 'public', '--enable', '--port', 3000, '--templates', './templates', '--templates', './templates2', '--serve']
        const options = map(args)
        assert.equal(options.help, true)
        assert.equal(options.folder, 'public')
        assert.equal(options.enable, true)
        assert.equal(options.port, 3000)
        assert.equal(options.templates.length, 2)
        assert.equal(options.serve, true)
    })
})