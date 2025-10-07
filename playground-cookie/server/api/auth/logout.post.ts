import { deleteCookie, eventHandler } from 'h3'

export default eventHandler((event) => {
    deleteCookie(event, 'ApplicationAuth')
    return { status: 'OK' }
})
