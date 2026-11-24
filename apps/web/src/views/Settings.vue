<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, setToken } from '../api.js'
import { useSortable } from '../use-sortable.js'
import { desktopNavLayout, setDesktopNavLayout } from '../use-layout.js'
import { CORNER_ITEMS, CORNER_MODES, CORNER_SLOTS, shelfCorners, shelfCornerModes, setCorner, setCornerMode } from '../use-shelf-corners.js'

const route = useRoute()
const router = useRouter()

const SECTIONS = [
  { id: 'account', label: '账号管理', icon: '👤', desc: '账号信息、密码与用户' },
  { id: 'layout', label: '布局设定', icon: '🎨', desc: '选择桌面导航与显示布局' },
  { id: 'shelf', label: '书架设置', icon: '🗂️', desc: '批量管理与分组' },
  { id: 'books', label: '书籍管理', icon: '📚', desc: '导入、书仓、缓存与阅读工具' },
  { id: 'data', label: '数据管理', icon: '📈', desc: '阅读统计、备份与 WebDAV' },
  { id: 'system', label: '系统', icon: '⚙️', desc: '运行状态' },
  { id: 'about', label: '关于', icon: 'ℹ️', desc: '应用信息、更新日志与版本' },
]

const CHANGELOG = [
  {
    version: '1.4.8',
    date: '2026-11-24',
    items: ['左侧导航书架三种模式统一列间距 16px、行间距 20px，并重新均分封面/网格/横向模式尺寸'],
  },
  {
    version: '1.4.7',
    date: '2026-11-24',
    items: ['左侧导航书架布局：封面 10 列、网格 8 列、横向 4 列，并分别铺满内容区'],
  },
  {
    version: '1.4.6',
    date: '2026-11-24',
    items: ['修复网页版首次打开时书架页未满铺、需要刷新后才铺满的问题'],
  },
  {
    version: '1.4.5',
    date: '2026-11-23',
    items: ['后端重启后要求重新登录', 'sessions 表新增 boot_id，启动时清理上一进程会话', '旧 token / cookie 在后端重启后返回 NEED_LOGIN'],
  },
  {
    version: '1.4.4',
    date: '2026-11-23',
    items: ['管理员可在用户管理中新建账号，并在创建时配置书籍/书源上限与 WebDAV、书仓、书源、RSS 权限'],
  },
  {
    version: '1.4.3',
    date: '2026-11-23',
    items: [
      'EPUB 导入支持 EPUB3 导航目录、NCX 目录和内嵌封面，书仓分类导入后仍保留封面',
      'TXT / DOCX / MOBI / PDF 没有内嵌封面时自动生成文字封面',
      '书源搜索封面支持相对地址、协议相对地址，并带 Referer 走服务端代理',
      '默认普通账号 reader 可在多用户模式下删除，重启后不再自动恢复',
      '阅读设置改为两列布局，背景主题每行 5 个',
    ],
  },
  {
    version: '1.4.2',
    date: '2026-11-23',
    items: [
      '阅读页所有弹层宽度改为跟随整页阅读宽度，实时响应页宽设置（不扣页边距）',
      '阅读设置所有滑杆改为可输入数值 + 增减按钮',
      '设置弹层滚动条贴右边缘放置',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-11-23',
    items: ['阅读设置弹层的滚动条移入内容区，右侧不再出现白边，右上角改为圆角并与正文宽度对齐'],
  },
  {
    version: '1.4.0',
    date: '2026-11-23',
    items: ['本地 TXT / DOCX / MOBI / PDF 分章新增识别「1、异界来客」这类数字编号标题'],
  },
  {
    version: '1.3.10',
    date: '2026-11-23',
    items: ['阅读页书源、目录、设置、段评等所有弹层改为与正文内容区同宽，并跟随页宽/页边距实时调整'],
  },
  {
    version: '1.3.9',
    date: '2026-11-20',
    items: ['修复书架页面初始宽度判断错误，彻底消除切换时的封面闪烁'],
  },
  {
    version: '1.3.8',
    date: '2026-11-20',
    items: ['修复书架首次打开时被错误套用窄版内容宽度的问题'],
  },
  {
    version: '1.3.7',
    date: '2026-11-20',
    items: ['修复左侧导航从书架切到其他页面时书籍封面闪烁的问题'],
  },
  {
    version: '1.3.6',
    date: '2026-11-20',
    items: ['按截图箭头范围统一正文、段评和阅读页弹层为 780px，正文左右留白 36px'],
  },
  {
    version: '1.3.5',
    date: '2026-11-20',
    items: ['阅读页书源、设置、目录等所有弹层统一 820px', '目录改为每行两章显示'],
  },
  {
    version: '1.3.4',
    date: '2026-11-20',
    items: ['段评改为与阅读正文同为 820px 的底部抽屉，从底部滑入，不再居中弹窗'],
  },
  {
    version: '1.3.3',
    date: '2026-11-20',
    items: ['羊皮纸背景替换为 hectorqin/reader 项目内置高清羊皮纸原图'],
  },
  {
    version: '1.3.2',
    date: '2026-11-20',
    items: ['段评直接以完整大窗打开，加载完成前隐藏 iframe，消除白屏和黑屏闪烁'],
  },
  {
    version: '1.3.1',
    date: '2026-11-20',
    items: [
      '左侧功能区改为与右侧一致的加粗 SVG 图标并居中',
      '段评默认跟随阅读明暗与背景色，左侧切深色时自动夜间模式',
      '新增截图提取的羊皮纸背景图，原羊皮纸更名为沙漠',
      '阅读设置弹层右上角改为圆角',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-20',
    items: ['段评网页代理兼容书源 4280 主备线路，保留完整网页交互'],
  },
  {
    version: '1.2.10',
    date: '2026-11-20',
    items: ['段评代理识别书源内置主线路与备用线路，支持两条线路的网页段评'],
  },
  {
    version: '1.2.9',
    date: '2026-11-20',
    items: ['放宽段评网页代理对已保存书源线路的识别，兼容主线路与备用线路'],
  },
  {
    version: '1.2.8',
    date: '2026-11-20',
    items: ['修复段评同源代理接口需要登录导致 iframe 401 的问题'],
  },
  {
    version: '1.2.7',
    date: '2026-11-20',
    items: ['段评改为同源代理加载书源网页，完整保留网页排序、筛选、回复和动画', '修复点击回复时 reading value 报错', '段评与阅读正文统一 760px 内容宽度'],
  },
  {
    version: '1.2.6',
    date: '2026-11-20',
    items: [
      '段评排序改为可展开菜单：推荐/热度/时间/楼层',
      '段评头部单行化，小太阳/月亮支持明暗切换，右上改为刷新，点击空白关闭',
      '评论底部显示赞、踩、回复数，回复展开前显示引用原文与评论内容',
      '阅读页右侧查找、缓存、刷新与上下章图标改为加粗居中 SVG',
    ],
  },
  {
    version: '1.2.5',
    date: '2026-11-20',
    items: ['段评配图/配音数量异步补齐，分类标签显示真实数量'],
  },
  {
    version: '1.2.4',
    date: '2026-11-20',
    items: ['段评头部、分类计数、排序样式按参考图复刻', '段评滚动条改为圆角轨道与圆角滑块'],
  },
  {
    version: '1.2.3',
    date: '2026-11-20',
    items: ['段评面板加宽并改为单滚动条，补充楼层、称号与回复展开', '段评支持查看评论回复和继续加载更多回复'],
  },
  {
    version: '1.2.2',
    date: '2026-11-20',
    items: ['四个角标可分别设置常显、触碰显示、隐藏，并可独立配置位置'],
  },
  {
    version: '1.2.1',
    date: '2026-11-20',
    items: ['四个角标统一为 20px，右下角更多按钮不再缩放'],
  },
  {
    version: '1.2.0',
    date: '2026-11-20',
    items: [
      '书架四角角标缩小到 20px，和上一版来源角标尺寸一致',
      '书籍管理重组为：导入书籍、阅读工具、更新与缓存三类',
      '书仓归入导入书籍，缓存管理归入更新与缓存',
    ],
  },
  {
    version: '1.1.10',
    date: '2026-11-20',
    items: [
      '书仓已导入书籍支持移出书架，同时保留删除文件操作',
      '书架四角角标统一 26px 高度，支持在设置中自由配置显示位置',
      '新增书籍分组角标，未分组显示「未分组」',
      '段评改为浅色主题原生 UI，加入全部/配图/配音筛选与排序',
    ],
  },
  {
    version: '1.1.9',
    date: '2026-11-20',
    items: [
      '头像与用户名整体可点击，弹出账号菜单，点击外部自动收起',
      '段评面板接入书源网页版 UI，支持配图/配音与完整排序筛选',
      '阅读页书源按钮弹出当前书源、线路测速与切换',
      '阅读设置增加更多纸张背景、字体、正文/侧栏区分开关，修复进度条填充',
      '缩小正文中的神评论/本章说卡片，右侧功能按钮与上下章箭头加大',
    ],
  },
  {
    version: '1.1.8',
    date: '2026-11-20',
    items: ['段评请求仅在失败时补一次正文会话，减少首屏等待时间'],
  },
  {
    version: '1.1.7',
    date: '2026-11-20',
    items: [
      '胖虎书源支持线路切换与延迟测速',
      '段评支持头像、配图、语音与更清晰的元信息布局',
      '统计页饼图在宽屏保持一排显示，更新日志最多保留近 10 条',
    ],
  },
  {
    version: '1.1.6',
    date: '2026-11-20',
    items: ['书仓支持批量导入本地书籍，一次最多 100 本', '批量导入可选择书仓根目录或已有分类文件夹'],
  },
  {
    version: '1.1.5',
    date: '2026-11-20',
    items: ['主栏目在设置、书仓、书签等子页面始终保持高亮', '底部胶囊、左侧导航、移动端底部导航统一按栏目归属高亮'],
  },
  {
    version: '1.1.4',
    date: '2026-11-19',
    items: [
      '修复设置分类切换后高亮丢失的问题',
      '书仓已导入书籍显示「已导入书架」并变暗，未导入书籍高亮',
      '书仓导入弹窗自动识别 TXT 书名/作者，可修改分类、分组和简介',
      '书仓支持全选或勾选多本批量导入到指定书架分组',
      '书仓只允许在根目录创建分类，分类文件夹内不能再建子分类',
    ],
  },
  {
    version: '1.1.3',
    date: '2026-11-19',
    items: [
      '修复移动端书架继续阅读卡片横向溢出',
      '移动端书架标题、封面尺寸与分组标签重新对齐',
      '完成 29/29 测试套件、桌面两种布局与全部页面回归',
    ],
  },
  {
    version: '1.1.2',
    date: '2026-11-19',
    items: [
      '账号头像与下方「用户名」标签左对齐',
      '缓存与更新从书架设置移入书籍管理',
      '完成桌面/移动端、两种导航布局与全部功能回归测试',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-11-19',
    items: [
      '优化更新日志排版，与关于信息统一对齐与字号',
      '设置分类顺序调整为：账号、布局设定、书架设置、书籍管理',
      '批量管理书架与分组管理移入书架设置；账号头像与文字对齐',
      '布局设定去掉重复标题，重做布局预览图标与说明文字',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-19',
    items: [
      '新增书籍管理、布局设定两个设置分类',
      '网络小说每 24 小时随机检查 18 次；发现新章节后书架显示「有更新」角标',
      '进入阅读后自动清除该书的更新角标，正文仍按需加载',
      '关于页新增版本更新日志',
    ],
  },
  {
    version: '1.0.10',
    date: '2026-11-19',
    items: ['左侧导航固定展开', '设置/搜索/书源页面统一宽度', '三种书架模式固定卡片尺寸'],
  },
  {
    version: '1.0.9',
    date: '2026-11-19',
    items: ['布局选择卡片改紧凑', '左侧页面边距与封面尺寸修正', '去掉侧栏重复品牌'],
  },
]

const CHANGELOG_MAX = 10
const visibleChangelog = computed(() => CHANGELOG.slice(0, CHANGELOG_MAX))

const section = computed(() => {
  const wanted = String(route.params.section || '')
  return SECTIONS.some((item) => item.id === wanted) ? wanted : 'account'
})
const current = computed(() => SECTIONS.find((item) => item.id === section.value) || SECTIONS[0])
const adminUsers = computed(() => users.value.filter((user) => user.role === 'admin'))
const orderedUsers = computed(() => [...adminUsers.value, ...subUsers.value])

const me = ref({ username: '', role: 'user', avatar: '', authEnabled: false, allowWebdav: true, allowWarehouse: true })
const users = ref([])
const subUsers = ref([])
const avatarInput = ref(null)
const avatarBusy = ref(false)
const health = ref(null)
const groupList = ref([])
const oldPassword = ref('')
const newPassword = ref('')
const newGroupName = ref('')
const editingUser = ref('')
const userDraft = ref({})
const creatingUser = ref(false)
const emptyCreateDraft = () => ({
  username: '',
  password: '',
  note: '',
  bookLimit: 0,
  sourceLimit: 0,
  allowWebdav: true,
  allowWarehouse: true,
  allowEditSources: true,
  allowEditRss: true,
})
const createDraft = ref(emptyCreateDraft())
const loading = ref(false)
const importInput = ref(null)
const importBusy = ref(false)
const updateBusy = ref(false)
const cacheBusy = ref(false)
const shelfStatus = ref('')

const {
  start: startUserDrag,
  cancel: cancelUserDrag,
  draggingId: userDraggingId,
} = useSortable({
  getIds: () => subUsers.value.map((user) => user.username),
  move: (from, to) => {
    const list = [...subUsers.value]
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    subUsers.value = list
  },
  onCommit: saveUserOrder,
})

const {
  start: startGroupDrag,
  cancel: cancelGroupDrag,
  draggingId: groupDraggingId,
} = useSortable({
  getIds: () => groupList.value.map((group) => String(group.groupId)),
  move: (from, to) => {
    const list = [...groupList.value]
    const [item] = list.splice(from, 1)
    list.splice(to, 0, item)
    groupList.value = list
  },
  onCommit: saveGroupOrder,
})

const isAdmin = () => me.value.role === 'admin'
const appVersion = __APP_VERSION__

const uptimeText = computed(() => {
  const minutes = Math.round((Number(health.value?.uptime) || 0) / 60)
  if (!minutes) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
})

async function load() {
  loading.value = true
  try {
    const info = await api.getUserInfo()
    if (info) me.value = { ...me.value, ...info }
    health.value = await fetch('/api/health').then((response) => response.json()).catch(() => null)
    const groupRows = await api.groups()
    groupList.value = groupRows.filter((group) => Number(group.groupId) !== 0)
    if (isAdmin()) {
      users.value = await api.userList().catch(() => [])
      subUsers.value = users.value.filter((user) => user.role !== 'admin')
    }
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    loading.value = false
  }
}

async function loadGroups() {
  const groupRows = await api.groups().catch(() => null)
  if (groupRows) groupList.value = groupRows.filter((group) => Number(group.groupId) !== 0)
}

async function saveUserOrder() {
  try {
    await api.reorderUsers(subUsers.value.map((user) => user.username))
    window.__toast?.('账号顺序已保存')
  } catch (error) {
    window.__toast?.(error.message)
    await load()
  }
}

async function saveGroupOrder() {
  try {
    await api.reorderBookGroups(groupList.value.map((group) => group.groupId))
    window.__toast?.('分组顺序已保存')
  } catch (error) {
    window.__toast?.(error.message)
    await loadGroups()
  }
}

async function changePassword() {
  if (newPassword.value.length < 6) {
    window.__toast?.('新密码至少 6 位')
    return
  }
  try {
    await api.changePassword({ oldPassword: oldPassword.value, newPassword: newPassword.value })
    oldPassword.value = ''
    newPassword.value = ''
    window.__toast?.('密码已修改')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 取消修改密码：清空输入，等同撤销未保存的改动 */
function cancelPassword() {
  oldPassword.value = ''
  newPassword.value = ''
}

async function toggleRole(user) {
  if (user.role === 'admin') return
  if (!confirm(`把「${user.username}」设为管理员？`)) return
  try {
    await api.setUserRole({ username: user.username, role: 'admin' })
    await load()
    window.__toast?.('角色已更新')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function chooseLayout(value) {
  setDesktopNavLayout(value)
  window.__toast?.(value === 'left' ? '已切换为左侧导航布局' : '已切换为底部胶囊布局')
}

function goSection(id) {
  if (section.value !== id) router.push('/settings/' + id)
}

/** 头像压缩到 256px 再上传，避免大图写进数据库 */
async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !file.type.startsWith('image/')) return
  avatarBusy.value = true
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(file)
    })
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片解析失败'))
      img.src = dataUrl
    })
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size, size)
    const scale = Math.max(size / image.width, size / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
    const avatar = canvas.toDataURL('image/jpeg', 0.85)
    await api.setAvatar(avatar)
    me.value.avatar = avatar
    window.dispatchEvent(new Event('rp-user-updated'))
    window.__toast?.('头像已更新')
  } catch (error) {
    window.__toast?.(error.message)
  } finally {
    avatarBusy.value = false
  }
}

async function removeUser(user) {
  if (!confirm(`删除账号「${user.username}」？它的书架与书源会一并删除。`)) return
  try {
    await api.deleteUser({ username: user.username })
    await load()
    window.__toast?.('已删除')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function toggleCreateUser() {
  creatingUser.value = !creatingUser.value
  if (creatingUser.value) createDraft.value = emptyCreateDraft()
  editingUser.value = ''
}

async function submitCreateUser() {
  const username = createDraft.value.username.trim()
  if (!username) {
    window.__toast?.('请输入用户名')
    return
  }
  if (createDraft.value.password.length < 6) {
    window.__toast?.('密码至少 6 位')
    return
  }
  try {
    await api.createUser({ ...createDraft.value, username })
    window.__toast?.(`已创建用户「${username}」`)
    creatingUser.value = false
    createDraft.value = emptyCreateDraft()
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 打开子账号的配额与功能开关 */
function editUser(user) {
  if (editingUser.value === user.username) {
    editingUser.value = ''
    return
  }
  editingUser.value = user.username
  userDraft.value = {
    note: user.note || '',
    bookLimit: Number(user.bookLimit) || 0,
    sourceLimit: Number(user.sourceLimit) || 0,
    allowWebdav: Boolean(user.allowWebdav),
    allowWarehouse: Boolean(user.allowWarehouse),
    allowEditSources: Boolean(user.allowEditSources),
    allowEditRss: Boolean(user.allowEditRss),
  }
}

async function saveUserSettings(user) {
  try {
    await api.setUserSettings({ username: user.username, ...userDraft.value })
    await load()
    editingUser.value = ''
    window.__toast?.('权限已保存')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

/** 把管理员自己的书源/RSS 复制给子账号，供只读使用 */
async function copyUserLibrary(user) {
  if (!confirm(`把当前管理员的书源和 RSS 订阅复制给「${user.username}」？`)) return
  try {
    const result = await api.copyUserLibrary({ username: user.username })
    window.__toast?.(`已分配书源 ${result.sources} 个、RSS ${result.rss} 个`)
    await load()
  } catch (error) {
    window.__toast?.(error.message)
  }
}

function openImport() {
  importInput.value?.click()
}

async function importBook(event) {
  const file = event.target.files?.[0]
  if (!file) return
  importBusy.value = true
  shelfStatus.value = `正在导入《${file.name}》…`
  try {
    const book = await api.uploadLocal(file)
    shelfStatus.value = `已加入《${book?.name || file.name}》`
    window.__toast?.(shelfStatus.value)
    await loadGroups()
  } catch (error) {
    shelfStatus.value = error.message
    window.__toast?.(error.message)
  } finally {
    importBusy.value = false
    event.target.value = ''
  }
}

function goBatch() {
  router.push({ path: '/bookshelf', query: { manage: '1' } })
}

async function addGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  try {
    await api.saveBookGroup({ groupId: Date.now() % 100000, groupName: name })
    newGroupName.value = ''
    await loadGroups()
    window.__toast?.('分组已创建')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function renameGroup(group) {
  const name = prompt('新的分组名', group.groupName)
  if (!name || name === group.groupName) return
  try {
    await api.saveBookGroup({ groupId: group.groupId, groupName: name, orderNo: group.orderNo || 0 })
    await loadGroups()
    window.__toast?.('已改名')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function removeGroup(group) {
  if (!confirm(`删除分组「${group.groupName}」？组内书籍会回到「全部」，不会被删除。`)) return
  try {
    await api.deleteBookGroup(group.groupId)
    await loadGroups()
    window.__toast?.('已删除')
  } catch (error) {
    window.__toast?.(error.message)
  }
}

async function checkUpdates() {
  if (updateBusy.value) return
  updateBusy.value = true
  shelfStatus.value = '正在检查更新…'
  try {
    const started = await api.checkChapterUpdates()
    if (!started?.started) {
      shelfStatus.value = started?.reason === 'already-running' ? '已有检查在进行中' : '书架里还没有连载书'
      return
    }
    shelfStatus.value = `正在检查 ${started.total} 本…`
    for (let round = 0; round < 160; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const status = await api.chapterUpdateStatus()
      if (status.running) continue
      const count = status.updatedBooks?.length || 0
      shelfStatus.value = count ? `${count} 本有新章节` : '暂无更新'
      window.__toast?.(shelfStatus.value)
      return
    }
  } catch (error) {
    shelfStatus.value = error.message
    window.__toast?.(error.message)
  } finally {
    updateBusy.value = false
  }
}

async function refreshCache() {
  if (cacheBusy.value) return
  cacheBusy.value = true
  try {
    const shelf = await api.bookshelf()
    const targets = [...shelf]
      .sort((a, b) => Number(b.durChapterTime || 0) - Number(a.durChapterTime || 0))
      .slice(0, 5)
    if (!targets.length) {
      shelfStatus.value = '书架还是空的'
      return
    }
    shelfStatus.value = `正在刷新前 ${targets.length} 本的缓存…`
    for (const book of targets) await api.cacheBook(book.bookUrl, 20, true).catch(() => {})
    shelfStatus.value = '缓存已刷新'
    window.__toast?.('缓存已刷新')
  } catch (error) {
    shelfStatus.value = error.message
    window.__toast?.(error.message)
  } finally {
    cacheBusy.value = false
  }
}

async function logout() {
  await api.logout().catch(() => {})
  setToken('')
  location.href = '/login'
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-head">
      <h1>设置</h1>
      <span class="badge">{{ me.username || '未登录' }} · {{ isAdmin() ? '管理员' : '普通用户' }}</span>
      <div class="spacer" />
      <button class="ghost" :disabled="loading" @click="load">刷新</button>
    </div>

    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类">
        <button
          v-for="item in SECTIONS"
          :key="item.id"
          class="settings-nav-item"
          :class="{ active: section === item.id }"
          :aria-current="section === item.id ? 'page' : undefined"
          @click="goSection(item.id)"
        >
          <span class="settings-nav-icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <section class="settings-panel">
        <header class="settings-panel-head">
          <h2>{{ current.label }}</h2>
          <p>{{ current.desc }}</p>
        </header>

        <!-- 账号 -->
        <template v-if="section === 'account'">
          <div class="settings-card">
            <div class="settings-card-title">账号信息</div>
            <div class="settings-avatar-row">
              <button class="settings-avatar" :disabled="avatarBusy" title="点击更换头像" @click="avatarInput.click()">
                <img v-if="me.avatar" :src="me.avatar" alt="头像" />
                <span v-else>👤</span>
              </button>
              <div>
                <div style="font-weight: 600">{{ me.username || '未登录' }}</div>
                <div class="muted" style="font-size: 12px">{{ avatarBusy ? '上传中…' : '点击头像更换，支持 JPG/PNG/WebP' }}</div>
              </div>
              <input ref="avatarInput" type="file" accept="image/*" hidden @change="uploadAvatar" />
            </div>
            <div class="settings-kv"><span>用户名</span><b>{{ me.username || '—' }}</b></div>
            <div class="settings-kv"><span>角色</span><span class="badge accent">{{ isAdmin() ? '管理员' : '普通用户' }}</span></div>
            <div class="settings-kv">
              <span>登录模式</span>
              <span>{{ me.authEnabled ? '多用户（已开启登录）' : '单用户（无需登录）' }}</span>
            </div>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">修改密码</div>
            <div class="settings-inline-form">
              <input v-model="oldPassword" type="password" name="rp-old-pass" autocomplete="new-password" placeholder="原密码" style="max-width: 200px" />
              <input v-model="newPassword" type="password" name="rp-new-pass" autocomplete="new-password" placeholder="新密码（≥6 位）" style="max-width: 200px" />
              <template v-if="oldPassword || newPassword">
                <button class="primary" @click="changePassword">保存</button>
                <button class="ghost" @click="cancelPassword">取消</button>
              </template>
            </div>
          </div>

          <div v-if="isAdmin()" class="settings-card">
            <div class="settings-card-title">用户管理</div>
            <button class="settings-row" type="button" @click="toggleCreateUser">
              <div class="settings-row-icon">＋</div>
              <div class="settings-row-main">
                <div class="settings-row-title">新建用户</div>
                <div class="settings-row-desc">创建账号，并设置书籍/书源上限与功能权限</div>
              </div>
              <span class="settings-row-meta">{{ creatingUser ? '收起' : '创建' }}</span>
            </button>
            <div v-if="creatingUser" class="settings-user-editor">
              <div class="settings-inline-form" style="padding: 12px 0 10px">
                <label class="settings-field">
                  用户名
                  <input
                    v-model="createDraft.username"
                    type="text"
                    maxlength="32"
                    autocomplete="off"
                    placeholder="登录用户名"
                    style="width: 160px"
                  />
                </label>
                <label class="settings-field">
                  密码
                  <input
                    v-model="createDraft.password"
                    type="password"
                    autocomplete="new-password"
                    placeholder="至少 6 位"
                    style="width: 160px"
                  />
                </label>
                <label class="settings-field">
                  备注
                  <input
                    v-model="createDraft.note"
                    type="text"
                    maxlength="60"
                    placeholder="例如：家人 / 手机端"
                    style="width: 180px"
                  />
                </label>
                <label class="settings-field">
                  书籍上限
                  <input v-model.number="createDraft.bookLimit" type="number" min="0" step="1" placeholder="0 = 不限" />
                </label>
                <label class="settings-field">
                  书源上限
                  <input v-model.number="createDraft.sourceLimit" type="number" min="0" step="1" placeholder="0 = 不限" />
                </label>
              </div>
              <div class="settings-perms">
                <label><input v-model="createDraft.allowWebdav" type="checkbox" /> 启用 WebDAV</label>
                <label><input v-model="createDraft.allowWarehouse" type="checkbox" /> 启用书仓</label>
                <label><input v-model="createDraft.allowEditSources" type="checkbox" /> 编辑书源</label>
                <label><input v-model="createDraft.allowEditRss" type="checkbox" /> 编辑 RSS 源</label>
              </div>
              <div class="row" style="gap: 8px; flex-wrap: wrap">
                <button class="primary" @click="submitCreateUser">创建用户</button>
                <button class="ghost" @click="creatingUser = false">取消</button>
              </div>
              <div class="settings-row-desc" style="margin-top: 8px">
                新账号默认是普通用户；书籍/书源上限填 0 表示不限。创建后可在列表里继续调整权限或复制书源。
              </div>
            </div>
            <template v-for="user in orderedUsers" :key="user.username">
              <div
                class="settings-row"
                :data-sort-id="user.role === 'admin' ? undefined : user.username"
                :class="{ dragging: user.role !== 'admin' && userDraggingId === user.username, pinned: user.role === 'admin' }"
              >
                <div class="settings-row-icon">
                  <img v-if="user.avatar" :src="user.avatar" alt="" class="settings-user-avatar" />
                  <span v-else>👤</span>
                </div>
                <div class="settings-row-main">
                  <div class="settings-row-title">
                    {{ user.username }}
                    <span class="badge" :class="{ accent: user.role === 'admin' }" style="margin-left: 6px">
                      {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                    </span>
                    <span v-if="user.current" class="badge" style="margin-left: 6px">当前</span>
                    <span v-if="user.role === 'admin'" class="badge pinned-badge" style="margin-left: 6px">📌 已置顶</span>
                  </div>
                  <div class="settings-row-desc">
                    <template v-if="user.role === 'admin'">不受配额与功能开关限制</template>
                    <template v-else>
                      <span v-if="user.note" class="settings-user-note">备注：{{ user.note }} · </span>
                      书籍上限 {{ user.bookLimit || '不限' }} · 书源上限 {{ user.sourceLimit || '不限' }} ·
                      {{ user.hasPassword ? '已设密码' : '无密码' }}
                    </template>
                  </div>
                </div>
                <button v-if="user.role !== 'admin'" class="ghost" @click="editUser(user)">
                  {{ editingUser === user.username ? '收起' : '权限' }}
                </button>
                <button v-if="user.role !== 'admin'" class="ghost" @click="toggleRole(user)">设为管理员</button>
                <button v-if="user.role !== 'admin'" class="ghost" @click="removeUser(user)">删除</button>
                <span
                  v-if="user.role !== 'admin'"
                  class="sort-handle"
                  title="长按拖动排序"
                  @pointerdown.prevent="startUserDrag($event, user.username)"
                  @pointerup="cancelUserDrag"
                >≡</span>
                <span v-else class="sort-handle pinned-handle" title="管理员固定在顶部">📌</span>
              </div>

              <div v-if="editingUser === user.username" class="settings-user-editor">
                <div class="row" style="padding-top: 10px">
                  <button class="page-back-btn" @click="editingUser = ''"><span aria-hidden="true">←</span> 返回 用户管理</button>
                </div>
                <div class="settings-inline-form" style="padding: 12px 0 10px">
                  <label class="settings-field">
                    备注
                    <input v-model="userDraft.note" type="text" maxlength="60" placeholder="例如：家人 / 手机端" style="width: 180px" />
                  </label>
                  <label class="settings-field">
                    书籍上限
                    <input v-model.number="userDraft.bookLimit" type="number" min="0" step="1" placeholder="0 = 不限" />
                  </label>
                  <label class="settings-field">
                    书源上限
                    <input v-model.number="userDraft.sourceLimit" type="number" min="0" step="1" placeholder="0 = 不限" />
                  </label>
                </div>
                <div class="settings-perms">
                  <label><input v-model="userDraft.allowWebdav" type="checkbox" /> 启用 WebDAV</label>
                  <label><input v-model="userDraft.allowWarehouse" type="checkbox" /> 启用书仓</label>
                  <label><input v-model="userDraft.allowEditSources" type="checkbox" /> 编辑书源</label>
                  <label><input v-model="userDraft.allowEditRss" type="checkbox" /> 编辑 RSS 源</label>
                </div>
                <div class="row" style="gap: 8px; flex-wrap: wrap">
                  <button class="primary" @click="saveUserSettings(user)">保存权限</button>
                  <button class="ghost" @click="copyUserLibrary(user)">分配我的书源 / RSS</button>
                  <button class="ghost" @click="editingUser = ''">取消</button>
                </div>
                <div class="settings-row-desc" style="margin-top: 8px">
                  关闭「编辑书源 / 编辑 RSS 源」后，该账号不能自行增删改，只能使用你分配的源；之后改完书源再点一次「分配我的书源 / RSS」同步。
                </div>
              </div>
            </template>
            <div v-if="!orderedUsers.length" class="settings-kv"><span>还没有其他账号</span></div>
          </div>

          <div v-if="me.authEnabled" class="settings-card">
            <button class="settings-row danger" @click="logout">
              <div class="settings-row-icon">🚪</div>
              <div class="settings-row-main"><div class="settings-row-title">退出登录</div></div>
            </button>
          </div>
        </template>

        <!-- 书籍管理 -->
        <template v-else-if="section === 'books'">
          <div class="settings-card">
            <div class="settings-card-title">导入书籍</div>
            <input
              ref="importInput"
              type="file"
              accept=".txt,.epub,.docx,.mobi,.azw3,.azw,.pdf"
              hidden
              @change="importBook"
            />
            <button class="settings-row" :disabled="importBusy" @click="openImport">
              <div class="settings-row-icon">＋</div>
              <div class="settings-row-main">
                <div class="settings-row-title">导入本地书</div>
                <div class="settings-row-desc">TXT / EPUB / DOCX / MOBI / AZW3 / PDF</div>
              </div>
              <span class="settings-row-meta">{{ importBusy ? '导入中…' : '选择文件' }}</span>
            </button>
            <router-link v-if="me.allowWarehouse" class="settings-row link" to="/warehouse">
              <div class="settings-row-icon">🗄️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">书仓</div>
                <div class="settings-row-desc">批量上传本地书籍、按分类导入书架</div>
              </div>
            </router-link>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">阅读工具</div>
            <router-link class="settings-row link" to="/bookmarks">
              <div class="settings-row-icon">🔖</div>
              <div class="settings-row-main">
                <div class="settings-row-title">书签</div>
                <div class="settings-row-desc">按书查看已保存的阅读位置</div>
              </div>
            </router-link>
            <router-link class="settings-row link" to="/replace">
              <div class="settings-row-icon">✏️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">替换规则</div>
                <div class="settings-row-desc">正文清洗与错字替换</div>
              </div>
            </router-link>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">更新与缓存</div>
            <button class="settings-row" :disabled="updateBusy" @click="checkUpdates">
              <div class="settings-row-icon">🔄</div>
              <div class="settings-row-main">
                <div class="settings-row-title">检查更新</div>
                <div class="settings-row-desc">检查书架中连载书的新章节</div>
              </div>
              <span class="settings-row-meta">{{ updateBusy ? '检查中…' : '执行' }}</span>
            </button>
            <button class="settings-row" :disabled="cacheBusy" @click="refreshCache">
              <div class="settings-row-icon">⚡</div>
              <div class="settings-row-main">
                <div class="settings-row-title">刷新缓存</div>
                <div class="settings-row-desc">重新缓存最近阅读的前 5 本</div>
              </div>
              <span class="settings-row-meta">{{ cacheBusy ? '刷新中…' : '执行' }}</span>
            </button>
            <router-link class="settings-row link" to="/cache">
              <div class="settings-row-icon">⬇️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">缓存管理</div>
                <div class="settings-row-desc">查看与清理已缓存的章节</div>
              </div>
            </router-link>
          </div>

          <p v-if="shelfStatus" class="settings-status">{{ shelfStatus }}</p>
        </template>

        <template v-else-if="section === 'layout'">
          <div class="settings-card layout-settings-card">
            <div class="layout-settings-body">
              <p class="layout-hint">请选择自己喜欢的布局方式，移动端默认使用液态玻璃胶囊导航。</p>
              <div class="layout-options">
                <button class="layout-option" :class="{ active: desktopNavLayout === 'bottom' }" @click="chooseLayout('bottom')">
                  <span class="layout-preview layout-preview-bottom">
                    <span class="lp-window">
                      <i class="lp-bar" />
                      <i class="lp-line wide" />
                      <i class="lp-line" />
                      <i class="lp-line short" />
                    </span>
                    <span class="lp-dock"><i /><i /><i /><i /></span>
                  </span>
                  <span class="layout-option-label">底部胶囊</span>
                </button>
                <button class="layout-option" :class="{ active: desktopNavLayout === 'left' }" @click="chooseLayout('left')">
                  <span class="layout-preview layout-preview-left">
                    <span class="lp-rail"><i /><i /><i /><i /></span>
                    <span class="lp-window">
                      <i class="lp-bar" />
                      <i class="lp-line wide" />
                      <i class="lp-line" />
                      <i class="lp-line short" />
                    </span>
                  </span>
                  <span class="layout-option-label">左侧导航</span>
                </button>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="section === 'shelf'">
          <div class="settings-card">
            <div class="settings-card-title">书架角标</div>
            <div class="settings-row" style="display: block">
              <div class="settings-row-desc" style="margin-bottom: 8px">
                可分别设置四个角标的位置和显示方式；显示方式支持常显、触碰显示、隐藏不显示。
              </div>
              <div v-for="item in CORNER_ITEMS" :key="item.key" class="corner-setting-row">
                <div class="settings-row-main">
                  <div class="settings-row-title">{{ item.label }}</div>
                  <div class="settings-row-desc">{{ item.desc }}</div>
                </div>
                <select
                  :value="shelfCorners[item.key]"
                  @change="setCorner(item.key, $event.target.value)"
                >
                  <option v-for="slot in CORNER_SLOTS" :key="slot.value" :value="slot.value">{{ slot.label }}</option>
                </select>
                <select
                  :value="shelfCornerModes[item.key]"
                  @change="setCornerMode(item.key, $event.target.value)"
                >
                  <option v-for="mode in CORNER_MODES" :key="mode.value" :value="mode.value">{{ mode.label }}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="settings-card">
            <div class="settings-card-title">批量与分组</div>
            <button class="settings-row" @click="goBatch">
              <div class="settings-row-icon">☑️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">批量管理书架</div>
                <div class="settings-row-desc">多选书籍，批量移动分组或删除</div>
              </div>
              <span class="settings-row-meta">前往</span>
            </button>
            <div class="settings-row" style="align-items: flex-start">
              <div class="settings-row-icon">🗂️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">分组管理</div>
                <div class="settings-row-desc">新建、改名或删除书架分组</div>
                <div class="settings-inline-form" style="padding: 8px 0 0">
                  <input v-model="newGroupName" placeholder="新分组名称" @keyup.enter="addGroup" />
                  <button class="primary" @click="addGroup">新建</button>
                </div>
                <div
                  v-for="group in groupList"
                  :key="group.groupId"
                  class="settings-group-row"
                  :data-sort-id="String(group.groupId)"
                  :class="{ dragging: groupDraggingId === String(group.groupId) }"
                >
                  <span
                    class="sort-handle"
                    title="长按拖动排序"
                    @pointerdown.prevent="startGroupDrag($event, String(group.groupId))"
                    @pointerup="cancelGroupDrag"
                  >≡</span>
                  <span>{{ group.groupName }}</span>
                  <button class="ghost" @click="renameGroup(group)">改名</button>
                  <button class="ghost" @click="removeGroup(group)">删除</button>
                </div>
                <div v-if="!groupList.length" class="settings-row-desc">还没有分组</div>
              </div>
            </div>
          </div>

        </template>

        <!-- 数据 -->
        <template v-else-if="section === 'data'">
          <div class="settings-card">
            <div class="settings-card-title">阅读数据</div>
            <router-link class="settings-row link" to="/stats">
              <div class="settings-row-icon">📊</div>
              <div class="settings-row-main">
                <div class="settings-row-title">阅读统计</div>
                <div class="settings-row-desc">阅读时长、章节与趋势</div>
              </div>
            </router-link>
            <router-link class="settings-row link" to="/backup">
              <div class="settings-row-icon">💾</div>
              <div class="settings-row-main">
                <div class="settings-row-title">备份与恢复</div>
                <div class="settings-row-desc">导出书架与书源，或从备份恢复</div>
              </div>
            </router-link>
            <router-link v-if="me.allowWebdav" class="settings-row link" to="/webdav">
              <div class="settings-row-icon">☁️</div>
              <div class="settings-row-main">
                <div class="settings-row-title">WebDAV</div>
                <div class="settings-row-desc">浏览远端目录并做备份</div>
              </div>
            </router-link>
          </div>
        </template>

        <!-- 系统 -->
        <template v-else-if="section === 'system'">
          <div class="settings-card">
            <div class="settings-card-title">运行状态</div>
            <div class="settings-kv"><span>书源</span><b>{{ health?.sources ?? '—' }}</b></div>
            <div class="settings-kv"><span>书籍</span><b>{{ health?.books ?? '—' }}</b></div>
            <div class="settings-kv"><span>运行时长</span><b>{{ uptimeText }}</b></div>
          </div>
        </template>

        <!-- 关于 -->
        <template v-else>
          <div class="settings-card">
            <div class="settings-card-title">关于</div>
            <div class="settings-kv"><span>应用</span><b>胖虎阅读</b></div>
            <div class="settings-kv"><span>版本</span><b>{{ appVersion }}</b></div>
            <div class="settings-kv"><span>说明</span><span>自建小说阅读服务 · 阅读 3 书源 · 本地书籍</span></div>
          </div>
          <div class="settings-card">
            <div class="settings-card-title">更新日志</div>
            <div v-for="release in visibleChangelog" :key="release.version" class="changelog-item">
              <div class="changelog-head">
                <strong>v{{ release.version }}</strong>
                <span>{{ release.date }}</span>
              </div>
              <ul class="changelog-list">
                <li v-for="item in release.items" :key="item">{{ item }}</li>
              </ul>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
