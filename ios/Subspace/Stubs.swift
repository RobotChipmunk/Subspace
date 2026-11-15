import SwiftUI

// Temporary stand-ins so the shell can be compiled and driven before the real screens land.
struct FeedScreen: View { var body: some View { Text("Feed").font(.ssTitle) } }
struct TodosScreen: View { var body: some View { Text("Todos").font(.ssTitle) } }
struct ContextScreen: View { var body: some View { Text("Context").font(.ssTitle) } }
struct FollowingScreen: View { var body: some View { Text("Following").font(.ssTitle) } }
struct AgentsScreen: View { var body: some View { Text("Agents").font(.ssTitle) } }
struct PageView: View {
    var pageID: String
    var body: some View { Text(pageID) }
}
struct BlockView: View {
    var block: JSONValue
    var compact = false
    var body: some View { Text(block.str("text") ?? block.str("type") ?? "").font(.ssSecondary) }
}
