import { createContext } from 'react'

export const USER_TYPES = Object.freeze({
  INDIVIDUAL: 'individual',
  SMALL_BIZ: 'small_biz',
})

export const normalizeUserType = (value) =>
  value === USER_TYPES.SMALL_BIZ ? USER_TYPES.SMALL_BIZ : USER_TYPES.INDIVIDUAL

export const UserTypeContext = createContext(null)
