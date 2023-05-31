import { promises as File, createReadStream, createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { map } from './CliArgsParser.mjs'
import express from 'express'
import MarkdownIt from 'markdown-it'
import markdownItMeta from 'markdown-it-meta'
import {load as cheerio} from 'cheerio'
import handlebars from 'handlebars'
import { EventStream, KeyValueEvent } from './EventStream.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const args = map(process.argv.slice(2))

const stream = new EventStream();

Object.keys(args).forEach(key=>{
    stream.addMessage(`events:args:${key}`, new KeyValueEvent(key, args[key]))
})
if(Object.keys(args).length == 0) {
    stream.addMessage('events:args:help', new KeyValueEvent('help', true))
}

const log = (...parameters) => {
    if(args.verbose) console.log(new Date(), ...parameters)
}

const help = `
Usage: hfab [options]
    --help          Show this help message
    --file          The markdown file to transform into HTML
    --folder        The folder where the static files are located (defaults to ./www)
    --destination   The folder where the static files will be saved (defaults to ./dist)
    --scripts       The folder where scripts are located to agument the build process 
    --serve         Serve the static files
    --copy          Copy files in this folder to the destination
    --verbose       Show verbose output
`

const WWW = './www'
const DESTINATION = './dist'

const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
}).use(markdownItMeta)

const app = express()
app.engine('html', async (filename, options, cb) => {
    const html = await File.readFile(filename, 'utf-8')
    const $ = cheerio(html)
    const props = {}
    $('[itemprop]').each((i, el)=>{
        const $el = $(el)
        let prop = $el.attr('itemprop')
        let content = $el.attr('content')
        if(prop == 'headline') {
            content = $el.text()
        }
        if(prop == 'published') {
            content = new Date($el.attr('datetime'))
        }
        props[prop] = content
    })
    props.uri = filename.replace(`${__dirname}/${WWW}`, '')
    props.relativeLink = props.uri.replace(/^\//, '')
    $('meta').each((i, el) => {
        const $el = $(el)
        let name = $el.attr('name')
        let content = $el.attr('content')
        if(name == 'tags') {
            content = content.split(',')
        }
        props[name] = content
    })

    const template = handlebars.compile(html)
    log('rendering ', filename)
    cb(null, template({...props, ...options}))
})

app.engine('md', async (filePath, options, callback)=>{
    try{
        let data = await File.readFile(filePath, 'utf-8')
        let output = markdown.render(data)
        output = `{{#> ${markdown.meta.layout}}}\n${output}{{/${markdown.meta.layout}}}\n`
        markdown.meta.uri = filePath.replace(`${__dirname}`, '').replace('.md', '.html')
        markdown.meta.relativeLink = markdown.meta.uri.replace(/^\//, '')
        markdown.meta.tags = markdown.meta?.tags ?? []
        let template = handlebars.compile(output)
        try{
            let stat = await File.stat(filePath)
            markdown.meta.birthtime = stat.birthtime
        }catch(e){
            console.error(e)
        }
        if(markdown.meta.published) markdown.meta.displayDate = markdown.meta.published.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        if(markdown.meta.should_publish == 'yes') posts.push(markdown.meta)
        callback(null, template({...markdown.meta, ...options}))
    }catch(e){
        callback(e, null)
    }
})

app.use(express.static(args.destination ?? DESTINATION))

const registerPartials = async (folder, handlebars) => {
    const files = await File.readdir(folder, { withFileTypes: true })
    for await (let file of files) {
        const filePath = `${folder}/${file.name}`  
        if (file.isDirectory()) {
            await registerPartials(filePath, handlebars)
        } else {
            if(!(filePath.toLowerCase().includes('layouts') || filePath.toLowerCase().includes('partials'))) continue
            if (!filePath.endsWith('.html')) continue
            
            const partialName = filePath.split(path.sep).slice(1).join(path.sep)
            const partial = await File.readFile(filePath, 'utf-8')
            log(folder, partialName)
            handlebars.registerPartial(partialName, partial)
        }
    }
}

const render = async (files, app, source, destination, hooks = []) => {
    const uris = []
    destination = destination.replace('./', '').replace(/^\//, '')
    app.set('views', [source])
    for await (let file of files) {
        if(file.path.toLowerCase().includes('/layouts') || file.path.toLowerCase().includes('/partials')) continue

        if (!(file.name.endsWith('.html') || file.name.endsWith('.md'))) {
            copyFilesFromSourceToDestination([file], source, destination, hooks)
            continue
        }

        const destinationFolderToCreate = file.path.replace(source, destination)
        await File.mkdir(destinationFolderToCreate, { recursive: true })

        const viewKey = path.join(file.path.replace(source, ''), file.name).replace(/^\//, '')
        let defaultEngine = path.extname(file.name).replace('.', '')
        app.set('view engine', defaultEngine)
        let model = {}
        for await (let hook of hooks) {
            if (!hook?.model) continue
            model = Object.assign(model, await hook.model(file, model))
        }

        app.render(viewKey, model, async (err, html) => {
            if (err) {
                console.error('error rendering', err)
                console.error('file', file.name)
                reject(err)
                return
            }
            html = html.split('\n').map(line => line.trim().replace(/^\s+/, '')).join('\n')

            const transformedFilePath = path.join(destinationFolderToCreate, file.name.replace('.md', '.html'))
            log('Creating', transformedFilePath)
            await File.writeFile(transformedFilePath, html, 'utf-8')
            for await (let hook of hooks) {
                if (!hook?.transformed) continue
                await hook.transformed(transformedFilePath)
            }
            uris.push(transformedFilePath.replace(destination.replace('./', ''), ''))
        })
    }
    return uris
}

const copyFilesFromSourceToDestination = async (files, source, destination, hooks) => {
    for await (let file of files) {
        if (file.name == '.DS_Store') continue
        const folderStructure = file.path.replace(source, '').replace(/^.?\//, '')
        try { await File.mkdir(path.join(destination, folderStructure), { recursive: true }) } catch (e) { log(e.message) }
        if (file.isDirectory()) {
            const filesInFolder = []
            for await (let file of await getFilesRecursively(path.join(source, folderStructure), { withFileTypes: true })) {
                filesInFolder.push(file)
            }  
            await copyFilesFromSourceToDestination(filesInFolder, path.join(source, file.path), path.join(destination, folderStructure), hooks)
            continue
        }
        createReadStream(path.join(file.path, file.name)).pipe(createWriteStream(path.join(destination, folderStructure, file.name)))
        for await (let hook of hooks) {
            if (!hook?.copied) continue
            await hook.copied(path.join(destination, folderStructure, file.name))
        }
    }
}

const getFilesRecursively = async function *(folder) {
    try {
        for await (let file of await File.readdir(folder, { withFileTypes: true })) {
            if (file.isDirectory()) {
                yield* getFilesRecursively(path.join(folder, file.name))
            } else {
                file.path = (file.path ?? folder) // file.path wasn't added until node 20.1.0
                yield file
            }
        }    
    } catch(e) {
        console.error(e)
    }
}

const loadScripts = async (scripts, app, args) => {
    const all = []
    for await (let script of scripts) {
        const filePath = path.resolve(script.path, script.name)
        all.push(await loadScript(filePath, app, args))
    }
    return all
}

const loadScript = async (filePath, app, args) => {
    let mod = null
    try {
        mod = await (await import(filePath)).default(app, args)
    } catch (e) {
        console.error(`
        Error running script ${filePath}
        `, e)
    }
    return mod
}

const transform = async (files, source, destination, hooks) => {
    try{await File.mkdir(destination)}catch(e){}
    for await (let folder of [source]) {
        await registerPartials(folder, handlebars, hooks)
    }
    await render(files, app, source, destination, hooks)
}


const scriptsFolder = []
let scripts = []

stream.createGroup('handlers:scripts', 'events:args:scripts', async messages => {
    const scriptsFolder = []
    for await(let script of await getFilesRecursively(args.scripts, { withFileTypes: true })) {
        scriptsFolder.push(script)
    }
    scripts = await loadScripts(scriptsFolder, app, args)    
})
stream.createGroup('handlers:help', 'events:args:help', async messages => {
    console.log(help)
    process.exit(0)
})
stream.createGroup('handlers:folder', 'events:args:folder', async messages => {
    const filesInFolder = []
    const folderWithoutDot = args.folder.replace('./', '')
    for await (let file of await getFilesRecursively(folderWithoutDot, { withFileTypes: true })) {
        filesInFolder.push(file)
    }
    await transform(filesInFolder, folderWithoutDot, args.destination ?? DESTINATION, scripts)
})
stream.createGroup('handlers:file', 'events:args:file', async messages => {
    const parts = args.file.replace('./', '').split(path.sep)
    const file = parts.pop()
    const filesInFolder = []
    for await (let file of await getFilesRecursively(parts.join(path.sep), { withFileTypes: true })) {
        filesInFolder.push(file)
    }

    const files = filesInFolder.filter(f => f.name == file)
    await transform(files, parts[0], args.destination ?? DESTINATION, scripts)
})
stream.createGroup('handlers:copy', 'events:args:copy', async messages => {
    const filesInFolder = []
    if (!Array.isArray(args.copy)) {
        args.copy = [args.copy]
    }
    for await (let folderWithoutDot of args.copy) {
        folderWithoutDot = folderWithoutDot.replace('./', '')
        for await (let file of await getFilesRecursively(folderWithoutDot, { withFileTypes: true })) {
            filesInFolder.push(file)
        }
        await copyFilesFromSourceToDestination(filesInFolder, folderWithoutDot, args.destination ?? DESTINATION, scripts)
    }
})
stream.createGroup('handlers:serve', 'events:args:serve', async messages => {
    app.listen(args.port ?? 3001, ()=>{
        console.log(`listening on http://localhost:${args.port ?? 3001}`)
    })
    stream.deleteGroup('handlers:serve')
})
