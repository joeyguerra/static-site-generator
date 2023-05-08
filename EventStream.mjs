class EventStream {
    constructor() {
        this.stream = new Map()
        this.groups = new Map()
    }
    async addMessage(id, message) {
        if (!this.stream.has(id)) {
            this.stream.set(id, [])
        }
        this.stream.get(id).push(message)
        for await (const groupId of this.groups.keys()) {
            await this.notifyConsumers(groupId)
        }
    }
    async createGroup(groupName, streamKey, callback) {
        if (!this.groups.has(groupName)) {
            this.groups.set(groupName, new Map())
        }
        this.groups.get(groupName).set(streamKey, { position: 0, callback })
        await this.notifyConsumers(groupName)
    }
    deleteGroup(groupName, streamKey) {
        const group = this.groups.get(groupName)
        if (group) {
            group.delete(streamKey)
        }
    }
    async notifyConsumers(groupName) {
        const group = this.groups.get(groupName)
        if (!group) {
            return
        }

        for await (const [streamId, { position, callback }] of group) {
            const messages = this.stream.get(streamId) || []
            if (position >= messages.length) {
                group.set(streamId, { position: 0, callback })
                continue
            }
            const newMessages = messages.slice(position);
            // console.log(`Consumer in group ${groupName} received messages: `, newMessages)
            !(callback instanceof Function) || await callback(newMessages)
            !(callback?.update) || await callback.update(newMessages)

            group.set(streamId, { position: position + newMessages.length, callback })
        }
    }
}

class KeyValueEvent {
    constructor(key, value) {
        this.key = key;
        this.value = value;
        this.kind = 'KeyValueEvent'
        this.version = '2023-05-06'
        this.occurredAt = new Date().toISOString()
        this.recordedAt = new Date().toISOString()
    }
}

export { EventStream, KeyValueEvent }