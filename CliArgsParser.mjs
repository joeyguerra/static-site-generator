

const makeKeyValueObservable = obj=>{
    const observers = {}
    const api = {
        changed(key, old, value){
            if(!observers[key]) return
            observers[key].forEach(o=>{
                o.observer.update ? o.observer.update(key, old, value) : o.observer(key, old, value)
            })
        },
        observe(key, observer){
            if(!observers[key]) observers[key] = []
            observers[key].push({key, observer})
        }
    }
    const cached = Object.assign({}, obj)
    const target = {}
    Object.keys(obj).forEach(key=>{
        Reflect.defineProperty(target, key, {
            get(){
                return cached[key]
            },
            set(value){
                const old = cached[key]
                cached[key] = value
                api.changed(key, old, value)
            },
            enumerable: true
        })
    })
    return Object.assign(target, api)
}

const map = (args) => {
    const options = {}
    return args.reduce((acc, arg, i) => {
        if(arg == null) return acc
        if(arg.toString().length == 0) return acc
        if (arg.toString().startsWith('--')) {
            const optionName = arg.slice(2)
            if (acc[optionName]) {
                if (!Array.isArray(acc[optionName])) {
                    acc[optionName] = [acc[optionName]]
                }
                acc[optionName].push(args[i+1])
                return acc
            }
            
            if (!args[i+1]) {
                acc[optionName] = true
                return acc
            }

            acc[optionName] = args[i+1]?.toString().indexOf('--') > -1 ? true : args[i+1]
        }
        return acc
    }, options)
}

export {map}