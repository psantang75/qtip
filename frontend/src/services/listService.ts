import { api } from './authService'

export interface ListItem {
  id: number
  list_type: string
  item_key?: string    // stored value for label-override lists (e.g. 'WEEKLY')
  category?: string
  label: string
  sort_order: number
  is_active: boolean
}

const listService = {
  async getItems(listType: string, includeInactive = false): Promise<ListItem[]> {
    const { data } = await api.get('/list-items', {
      params: { list_type: listType, include_inactive: includeInactive ? 'true' : undefined },
    })
    return data?.data ?? []
  },

  async createItem(payload: { list_type: string; category?: string; label: string; sort_order?: number }): Promise<ListItem> {
    const { data } = await api.post('/list-items', payload)
    return data?.data ?? data
  },

  async updateItem(id: number, payload: { label?: string; category?: string; sort_order?: number }): Promise<ListItem> {
    const { data } = await api.put(`/list-items/${id}`, payload)
    return data?.data ?? data
  },

  async toggleStatus(id: number): Promise<ListItem> {
    const { data } = await api.patch(`/list-items/${id}/status`)
    return data?.data ?? data
  },

  async deleteItem(id: number): Promise<void> {
    await api.delete(`/list-items/${id}`)
  },

  async reorder(items: { id: number; sort_order: number }[]): Promise<void> {
    await api.post('/list-items/reorder', { items })
  },
}

export default listService
