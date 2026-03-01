import { useMemo, useState } from 'react'
import { normalizeUserType, UserTypeContext, USER_TYPES } from './userTypeContext'

export function UserTypeProvider({ children, initialUserType = USER_TYPES.INDIVIDUAL }) {
  const [userType, setUserType] = useState(() => normalizeUserType(initialUserType))

  const value = useMemo(
    () => ({
      userType,
      isIndividual: userType === USER_TYPES.INDIVIDUAL,
      isSmallBiz: userType === USER_TYPES.SMALL_BIZ,
      setUserType: (nextUserType) => setUserType(normalizeUserType(nextUserType)),
    }),
    [userType]
  )

  return <UserTypeContext.Provider value={value}>{children}</UserTypeContext.Provider>
}
