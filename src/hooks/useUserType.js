import { useContext } from 'react'
import { UserTypeContext } from '../providers/userTypeContext'

export function useUserType() {
  const context = useContext(UserTypeContext)
  if (!context) {
    throw new Error('useUserType must be used within a UserTypeProvider.')
  }
  return context
}
